// Memory Graph Explorer — UI.
//
// Renders the MemoryGraphService dump as a force-directed node-link diagram and
// shows what the cascade retrieval pipeline would surface for a given query.
// Hand-written vanilla JS + d3 (vendored as d3.min.js, no bundler).
//
// What the UI does on a search:
//   - Calls GET /api/search?q=<query>, which returns the cascade result with
//     { id, score, via: { from, edgeKind } | null } per result. Seeds have
//     `via === null`; cascaded results have the edge that carried their score.
//   - Dims every node/edge not on the walked path.
//   - Lights up each `via` edge in red with the decayed score as its label,
//     making it possible to see *which edge* contributed *how much* score
//     at *which hop*.

(function () {
  "use strict";

  const svg = d3.select("#graph");
  const statsEl = document.getElementById("stats");
  const seedModeEl = document.getElementById("seed-mode");
  const emptyEl = document.getElementById("empty");
  const qInput = document.getElementById("q");
  const detailEl = document.getElementById("detail");
  const detailKindEl = document.getElementById("detail-kind");
  const detailTitleEl = document.getElementById("detail-title");
  const detailBodyEl = document.getElementById("detail-body");
  const detailCloseEl = document.getElementById("detail-close");

  // d3 layers — created once, populated on data load.
  const root = svg.append("g").attr("class", "root");
  const edgeLayer = root.append("g").attr("class", "edges");
  const edgeLabelLayer = root.append("g").attr("class", "edge-labels");
  const nodeLayer = root.append("g").attr("class", "nodes");
  const labelLayer = root.append("g").attr("class", "node-labels");

  // Pan + zoom. d3-zoom translates the `root` group so all layers move
  // together; scale is applied here too.
  const zoom = d3
    .zoom()
    .scaleExtent([0.1, 8])
    .on("zoom", (event) => {
      root.attr("transform", event.transform);
    });
  svg.call(zoom);

  // Drag individual nodes by clicking + dragging the circle. The simulation
  // pins the dragged node so physics keeps the rest of the layout
  // responsive, then releases on drag end.
  const drag = d3
    .drag()
    .on("start", (event, d) => {
      if (!event.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) sim.alphaTarget(0);
      // Unfix: let physics settle the node back into the force layout. If the
      // user wants it pinned, they drag it again.
      d.fx = null;
      d.fy = null;
    });

  // Force simulation — many-body repulsion + center pull + link springs.
  // Charge is on the negative side (nodes repel) and tuned for ~50–500 nodes.
  const sim = d3
    .forceSimulation()
    .force(
      "link",
      d3
        .forceLink()
        .id((d) => d.id)
        .distance(60)
        .strength(0.5),
    )
    .force("charge", d3.forceManyBody().strength(-180))
    .force("center", d3.forceCenter())
    .force(
      "collide",
      d3.forceCollide().radius((d) => nodeRadius(d) + 4),
    )
    .on("tick", tick);

  let linksSel = edgeLayer.selectAll("line.edge");
  let nodesSel = nodeLayer.selectAll("circle.node");
  let edgeLabelsSel = edgeLabelLayer.selectAll("text.edge-label");
  let nodeLabelsSel = labelLayer.selectAll("text.node-label");

  function nodeRadius(d) {
    // Memory nodes are larger (the things we care about). Tags / Clusters
    // are smaller hubs.
    if (d.kind === "Memory") return 6;
    if (d.kind === "Tag") return 4;
    return 8; // Cluster
  }

  function nodeColor(d) {
    if (d.kind === "Memory") return "var(--memory)";
    if (d.kind === "Tag") return "var(--tag)";
    return "var(--cluster)";
  }

  function tick() {
    linksSel
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    nodesSel.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
    edgeLabelsSel
      .attr("x", (d) => (d.source.x + d.target.x) / 2)
      .attr("y", (d) => (d.source.y + d.target.y) / 2 - 4);
    nodeLabelsSel.attr("x", (d) => d.x).attr("y", (d) => d.y + nodeRadius(d) + 9);
  }

  function fitToView(nodes) {
    if (nodes.length === 0) return;
    const w = svg.node().clientWidth || 800;
    const h = svg.node().clientHeight || 600;
    sim.force("center", d3.forceCenter(w / 2, h / 2));
    sim.alpha(0.8).restart();
  }

  function render(graph) {
    const { nodes, edges, embedderAvailable } = graph;
    if (nodes.length === 0) {
      emptyEl.hidden = false;
      statsEl.textContent = "(no memories)";
      return;
    }
    emptyEl.hidden = true;

    // forceLink()'s default accessors read `.source`/`.target`, and it
    // resolves those id strings to node objects *in place* on whatever array
    // it's given. The same array (same object references) must be bound to
    // the DOM here, or tick()'s `d.source.x` reads stale/undefined data —
    // build it once and pass it to both .data() below and sim.force("link").
    const links = edges.map((e) => ({
      source: e.from,
      target: e.to,
      kind: e.kind,
      weight: e.weight,
    }));

    // Edge weights cap link distance inversely: stronger bonds (Supersedes
    // 0.9) sit closer than weaker ones (InCluster 0.6).
    linksSel = edgeLayer
      .selectAll("line.edge")
      .data(links, (d) => `${d.source}->${d.target}:${d.kind}`)
      .join("line")
      .attr("class", (d) => `edge ${d.kind}`)
      .attr("stroke-width", (d) => 0.8 + d.weight * 2);

    nodesSel = nodeLayer
      .selectAll("circle.node")
      .data(nodes, (d) => d.id)
      .join("circle")
      .attr("class", (d) => `node kind-${d.kind}`)
      .attr("r", nodeRadius)
      .style("fill", nodeColor)
      .call(drag)
      // d3-drag swallows the click that follows a drag that actually moved,
      // so a plain click handler here means "clicked without dragging".
      .on("click", (event, d) => {
        event.stopPropagation();
        openDetail(d.id);
      });

    // Tag/Cluster labels are hidden by default to avoid crowding (see
    // node-labels below) — a native <title> makes every node's name/kind
    // discoverable on hover without adding permanent visual clutter.
    nodesSel
      .selectAll("title")
      .data((d) => [d])
      .join("title")
      .text((d) => `${d.label} (${d.kind})`);

    nodeLabelsSel = labelLayer
      .selectAll("text.node-label")
      .data(
        nodes.filter((n) => n.kind !== "Tag"), // tag labels crowd fast
        (d) => d.id,
      )
      .join("text")
      .attr("class", "node-label")
      .text((d) => (d.label.length > 22 ? d.label.slice(0, 21) + "…" : d.label));

    edgeLabelsSel = edgeLabelLayer
      .selectAll("text.edge-label")
      .data([])
      .join("text")
      .attr("class", "edge-label");

    sim.nodes(nodes);
    sim.force("link").links(links);
    fitToView(nodes);

    const memCount = nodes.filter((n) => n.kind === "Memory").length;
    const tagCount = nodes.filter((n) => n.kind === "Tag").length;
    const clusterCount = nodes.filter((n) => n.kind === "Cluster").length;
    statsEl.textContent =
      `${memCount} memories · ${edges.length} edges · ` +
      `${tagCount} tags · ${clusterCount} clusters · ` +
      (embedderAvailable ? "embedder ready" : "keyword-only");
  }

  function clearHighlights() {
    nodesSel.classed("dim", false).classed("match", false);
    nodeLabelsSel.classed("dim", false);
    linksSel.classed("dim", false).classed("path", false);
    edgeLabelsSel.classed("show", false);
  }

  // Highlight the walked path returned by /api/search. The cascade response
  // carries { id, score, via } per result; we light up each `via` edge in
  // red with the result's decayed score as its label, so a user can see
  // which edge contributed how much.
  function highlightResults(results) {
    clearHighlights();

    // Build the set of edges actually walked: each result with a non-null
    // `via` corresponds to one edge (via.from → via.to, kind=via.edgeKind).
    const walkedEdges = new Set();
    const matchedNodes = new Set();
    for (const r of results) {
      matchedNodes.add(r.id);
      if (r.via) {
        walkedEdges.add(`${r.via.from}->${r.id}:${r.via.edgeKind}`);
      }
    }

    linksSel
      .classed("path", (d) =>
        walkedEdges.has(`${d.source.id}->${d.target.id}:${d.kind}`) ||
        walkedEdges.has(`${d.target.id}->${d.source.id}:${d.kind}`),
      )
      .classed("dim", (d) => {
        const onPath =
          walkedEdges.has(`${d.source.id}->${d.target.id}:${d.kind}`) ||
          walkedEdges.has(`${d.target.id}->${d.source.id}:${d.kind}`);
        return !onPath;
      });

    nodesSel
      .classed("match", (d) => matchedNodes.has(d.id))
      .classed("dim", (d) => !matchedNodes.has(d.id));

    nodeLabelsSel.classed("dim", (d) => !matchedNodes.has(d.id));

    // Per-edge score label. One label per walked edge, anchored at its
    // midpoint, showing the result's score (post-decay) — that's the
    // teaching surface the spec calls out.
    const labels = results
      .filter((r) => r.via)
      .map((r) => ({
        from: r.via.from,
        to: r.id,
        kind: r.via.edgeKind,
        score: r.score,
        source: { id: r.via.from },
        target: { id: r.id },
      }));

    edgeLabelsSel = edgeLabelLayer
      .selectAll("text.edge-label")
      .data(labels, (d) => `${d.from}->${d.to}:${d.kind}`)
      .join("text")
      .attr("class", "edge-label show")
      .text((d) => d.score.toFixed(3));
  }

  // Debounced fetch: typing in the search box debounces to 200ms so we don't
  // fire a request per keystroke. Empty query clears the highlight.
  let searchSeq = 0;
  let searchTimer = null;
  qInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = qInput.value.trim();
    if (q.length === 0) {
      clearHighlights();
      seedModeEl.hidden = true;
      return;
    }
    searchTimer = setTimeout(() => runSearch(q), 200);
  });

  async function runSearch(q) {
    const seq = ++searchSeq;
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) {
        clearHighlights();
        return;
      }
      const body = await res.json();
      // Stale response (a newer query already started) — drop it.
      if (seq !== searchSeq) return;
      if (body.results.length === 0) {
        clearHighlights();
      } else {
        highlightResults(body.results);
      }
      seedModeEl.hidden = false;
      seedModeEl.textContent = `seed: ${body.seedMode}`;
    } catch {
      clearHighlights();
    }
  }

  // ---------------------------------------------------------------------------
  // Node detail panel
  //
  // /api/graph carries only { id, kind, label } — enough to draw a circle and
  // nothing to read. The body of a memory is fetched on demand from
  // /api/node so the initial payload stays small on a large graph.
  // ---------------------------------------------------------------------------

  let selectedId = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    // textContent throughout: memory bodies are user text and must never be
    // parsed as HTML.
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function formatDate(ms) {
    if (!ms) return "unknown";
    return new Date(ms).toLocaleString();
  }

  function closeDetail() {
    detailEl.hidden = true;
    selectedId = null;
    if (nodesSel) nodesSel.classed("selected", false);
  }

  function section(parent, heading, child) {
    parent.appendChild(el("h4", null, heading));
    parent.appendChild(child);
  }

  function renderDetail(data) {
    detailKindEl.textContent = data.node.kind;
    detailTitleEl.textContent = data.node.label;
    detailBodyEl.replaceChildren();

    const entry = data.entry;
    if (entry) {
      if (entry.description) {
        section(
          detailBodyEl,
          "description",
          el("p", "detail-desc", entry.description),
        );
      }

      const meta = el("div", "detail-meta");
      for (const [key, value] of [
        ["type", entry.type],
        ["created", formatDate(entry.createdAt)],
        ["updated", formatDate(entry.updatedAt)],
      ]) {
        meta.appendChild(el("span", null, key));
        meta.appendChild(el("span", null, value));
      }
      section(detailBodyEl, "details", meta);

      if (entry.tags && entry.tags.length > 0) {
        const tags = el("div", "detail-tags");
        for (const tag of entry.tags) {
          tags.appendChild(el("span", "detail-tag", tag));
        }
        section(detailBodyEl, "tags", tags);
      }

      section(
        detailBodyEl,
        "content",
        el("pre", "detail-content", entry.content || "(empty)"),
      );
    } else {
      // Tag and Cluster nodes are synthetic groupings with no stored entry.
      // Say so, rather than rendering an empty panel that looks broken.
      section(
        detailBodyEl,
        "about",
        el(
          "p",
          "detail-empty",
          data.node.kind === "Memory"
            ? "This memory is in the graph but its file could not be read."
            : `A ${data.node.kind.toLowerCase()} groups the memories below. It has no content of its own.`,
        ),
      );
    }

    const list = el("ul", "detail-neighbors");
    if (data.neighbors.length === 0) {
      list.appendChild(el("li", "detail-empty", "none"));
    }
    for (const n of data.neighbors) {
      const li = el("li");
      const link = el("button", "detail-link", n.label);
      link.addEventListener("click", () => openDetail(n.id));
      li.appendChild(link);
      li.appendChild(
        el(
          "span",
          "detail-edge",
          `  ${n.direction === "out" ? "→" : "←"} ${n.edge}`,
        ),
      );
      list.appendChild(li);
    }
    section(detailBodyEl, `connected (${data.neighbors.length})`, list);

    detailEl.hidden = false;
  }

  async function openDetail(id) {
    selectedId = id;
    if (nodesSel) nodesSel.classed("selected", (d) => d.id === id);
    try {
      const res = await fetch(`/api/node?id=${encodeURIComponent(id)}`);
      if (!res.ok) {
        detailKindEl.textContent = "";
        detailTitleEl.textContent = id;
        detailBodyEl.replaceChildren(
          el("p", "detail-empty", `error: /api/node returned ${res.status}`),
        );
        detailEl.hidden = false;
        return;
      }
      const data = await res.json();
      // A slower earlier click must not overwrite a newer selection.
      if (selectedId === id) renderDetail(data);
    } catch (err) {
      detailBodyEl.replaceChildren(el("p", "detail-empty", `error: ${err.message}`));
      detailEl.hidden = false;
    }
  }

  detailCloseEl.addEventListener("click", closeDetail);
  svg.on("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });

  // Initial load.
  (async () => {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) {
        emptyEl.hidden = false;
        emptyEl.querySelector("p").textContent =
          `error: /api/graph returned ${res.status}`;
        return;
      }
      const graph = await res.json();
      render(graph);
    } catch (err) {
      emptyEl.hidden = false;
      emptyEl.querySelector("p").textContent = `error: ${err.message}`;
    }
  })();
})();
