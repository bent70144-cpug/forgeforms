// @formforge/core — analytics module public interface (spec §3: modules are
// consumed only through their index).
// INTEGRATION-DEBT: until T02 lands, sibling packages import this folder via a
// relative source path; afterwards switch to '@formforge/core'.

export * from "./types";
export * from "./bucket";
export * from "./rollup";
export * from "./partitions";
export * from "./beacon";
export * from "./service";
