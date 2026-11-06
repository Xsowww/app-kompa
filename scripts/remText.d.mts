type Node = { parent?: Node; selector?: string };
export const remText: {
  postcssPlugin: string;
  Declaration(decl: Node & { prop: string; value: string; source?: { input?: { file?: string } } }): void;
};
