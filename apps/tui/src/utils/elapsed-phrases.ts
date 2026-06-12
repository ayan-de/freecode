// Random elapsed-time phrases for completion messages
const elapsedPhrases = [
  "Baked",
  "Cooked",
  "Completed",
  "Finished",
  "Processed",
  "Executed",
  "Generated",
  "Built",
  "Produced",
  "Shipped",
  "Ready",
  "All set",
  "Wrapped up",
  "Done",
];

export function getRandomElapsedPhrase(): string {
  return elapsedPhrases[Math.floor(Math.random() * elapsedPhrases.length)];
}

// Random in-progress phrases for processing messages
const inProgressPhrases = [
  // Cooking Theme
  "Cooking up a solution...",
  "Baking your answer...",
  "Brewing something useful...",
  "Simmering...",
  "Baking...",
  "Preheating...",
  "Whisking ideas...",
  "Mixing ingredients...",
  "Seasoning the solution...",
  "Stirring the pot...",
  "Letting it marinate...",
  "Chef at work...",
  "Preparing the recipe...",
  "Plating the result...",
  // Workshop / Builder Theme
  "Forging...",
  "Crafting...",
  "Assembling...",
  "Building...",
  "Hammering it out...",
  "Refining...",
  "Shaping the solution...",
  "Putting the pieces together...",
  "In the workshop...",
  "Polishing the details...",
  // Factory Theme
  "Manufacturing...",
  "Fabricating...",
  "Producing...",
  "Calibrating...",
  "Running the assembly line...",
  "Finalizing production...",
  // Thinking Theme
  "Brewing ideas...",
  "Connecting the dots...",
  "Mapping it out...",
  "Crunching thoughts...",
  "Exploring possibilities...",
  "Thinking...",
  "Reasoning...",
  "Working it through...",
  "Solving...",
  "Analyzing...",
  // Magic / Alchemy Theme
  "Conjuring...",
  "Brewing a potion...",
  "Casting spells...",
  "Mixing elixirs...",
  "Performing alchemy...",
  "Summoning answers...",
  "Enchanting the output...",
  // Fun Agent Messages
  "Cooking up a solution...",
  "Baking your answer...",
  "Brewing something useful...",
  "Crafting the perfect response...",
  "Sharpening the code...",
  "Assembling the pieces...",
  "Taming the bugs...",
  "Teaching electrons new tricks...",
  "Negotiating with the compiler...",
  "Convincing the code to cooperate...",
];

export function getRandomInProgressPhrase(): string {
  return inProgressPhrases[
    Math.floor(Math.random() * inProgressPhrases.length)
  ];
}
