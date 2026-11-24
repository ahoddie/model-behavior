// The statements on the Statements page (table `topics`). Each is one plain sentence that people on both sides of a live
// AI policy debate have taken positions on. `keywords` (a Postgres regex, case-insensitive) picks which approved feed quotes
// are read against it. `load.ts` upserts these rows; the six statements that were already on the site keep their ids.
export type Statement = { id: string; label: string; description: string; positive: string; keywords: string; sort: number };

// Derek Thompson and Timothy B. Lee's five debates come first ("How to Sound Like an Expert in the 5 Biggest AI Debates",
// Nov 23, 2026, https://www.derekthompson.org/p/how-to-sound-like-an-expert-in-the). Four of the five are predictions, not
// policy questions; people still split on them, and they are read the same way.
export const STATEMENTS: Statement[] = [
  { id: "chips_china", label: "Chips for China", sort: 1,
    description: "Whether the US should stop American companies such as Nvidia from selling advanced AI chips to China.",
    positive: "The US should block sales of advanced AI chips to China.",
    keywords: "export control|chips? (to|for) china|h20|h200|nvidia.{0,40}china|china.{0,40}chips?|diffusion rule|smuggl|sell.{0,30}china" },
  { id: "rsi_2027", label: "Self-improving AI by 2027", sort: 2,
    description: "Whether AI that does most of the work of improving AI, speeding up its own progress, is about to arrive.",
    positive: "AI that speeds up its own research and development, so-called recursive self-improvement, will arrive by 2027.",
    keywords: "self-improv|self improv|recursive|automat\\w* (ai )?(research|r&d)|ai r&d|intelligence explosion|automated researcher|ai 2027|takeoff" },
  { id: "bubble", label: "An AI bubble", sort: 3,
    description: "Whether spending and stock prices tied to AI have run far ahead of what the technology will earn.",
    positive: "AI is in a financial bubble.",
    keywords: "bubble|overvalu|dot-?com|capex|circular (deal|financ)|froth|hype cycle|crash" },
  { id: "cyber", label: "AI and cyberattacks", sort: 4,
    description: "Whether AI is about to make serious cyberattacks much more common and damaging.",
    positive: "AI will soon make major cyberattacks far more common and damaging.",
    keywords: "cyber|hack|vulnerabilit|exploit|ransomware|zero-?day|critical infrastructure" },
  { id: "jobs", label: "Jobs", sort: 5,
    description: "Whether AI will put millions of people out of work in the next few years.",
    positive: "AI will destroy millions of jobs within the next few years.",
    keywords: "jobs?\\M|workers?|unemploy|labor|labour|displac|white.collar|entry.level" },
  { id: "preemption", label: "One national standard", sort: 6,
    description: "Whether a federal AI law should override state AI laws, or pause them while Congress acts.",
    positive: "Congress should set one national AI standard that overrides state AI laws.",
    keywords: "preempt|patchwork|moratorium|state (ai )?laws?|50 states|fifty states|national standard|federal standard|state-by-state" },
  // x_risk (sort 7) was already on the site and keeps its row and letters.
  { id: "open_weights", label: "Open-weight models", sort: 8,
    description: "Whether companies should be free to publish the weights of powerful models for anyone to use.",
    positive: "Companies should be free to release the weights of powerful AI models openly.",
    keywords: "open.?weight|open.?source|open models?|model weights|llama|deepseek|release (the )?weights" },
  { id: "transparency", label: "Safety plans and incident reports", sort: 9,
    description: "Whether frontier developers should have to publish safety plans and report serious incidents, as SB 53 and the RAISE Act require.",
    positive: "Frontier AI developers should be required to publish their safety plans and report serious incidents.",
    keywords: "transparen|disclos|safety (plan|framework|protocol)|incident report|sb ?53|raise act|report (serious|critical) (safety )?incidents" },
  { id: "liability", label: "Liability for harms", sort: 10,
    description: "Whether AI developers should be legally responsible when their systems cause serious harm.",
    positive: "AI developers should be legally liable when their systems cause serious harm.",
    keywords: "liab|sue\\M|lawsuit|duty of care|section 230|accountab|negligen|safe harbor" },
  { id: "child_safety", label: "Kids and chatbots", sort: 11,
    description: "Whether the law should require chatbots to protect minors, for example with age checks or limits on companion bots.",
    positive: "AI chatbots should be legally required to protect minors, for example with age checks or limits on companion bots.",
    keywords: "child|kids?\\M|minors?|teen|age verif|age check|companion|parent" },
  { id: "copyright", label: "Training on copyrighted work", sort: 12,
    description: "Whether training AI on copyrighted books, art, music, and news without permission counts as fair use.",
    positive: "Training AI on copyrighted work without permission is fair use.",
    keywords: "copyright|fair use|training data|licens\\w* (content|data)|authors|artists|publishers|creators" },
];

// Statements that stay on the page from before, with their rows untouched (letters are attached).
export const KEPT: Record<string, { sort: number; keywords: string }> = {
  x_risk: { sort: 7, keywords: "extinct|existential|x-risk|xrisk|wipe out|end of humanity|doom|human survival|annihilat" },
};
