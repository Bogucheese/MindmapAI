// MindmapAI fork: the hardcoded setFeedURL in electron.js points at
// jgraph/drawio-desktop releases. Our product versions (0.x) would always
// look outdated there and offer the official drawio installer, so update
// checks are disabled for this fork.
export function disableUpdate() { return true;}