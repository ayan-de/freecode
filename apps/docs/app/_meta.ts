import type { MetaRecord } from "nextra";

export default {
  index: {
    title: "Introduction",
    display: "hidden"
  },
  "-- start": {
    type: "separator",
    title: "Start here"
  },
  "getting-started": "Getting started",
  interfaces: "Interfaces",
  "-- use": {
    type: "separator",
    title: "Using FreeCode"
  },
  guides: "Guides",
  "-- deep": {
    type: "separator",
    title: "Under the hood"
  },
  internals: "Internals",
  reference: "Reference",
  contributing: "Contributing",
  extras: "Extras"
} satisfies MetaRecord;
