// originally from: https://github.com/codemirror/search/blob/main/src/selection-match.ts
import { SearchCursor } from "@codemirror/search";
import { combineConfig, Compartment, Extension, Facet, Range } from "@codemirror/state";
import { syntaxTree, tokenClassNodeProp } from "@codemirror/language";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { cloneDeep } from "lodash";
import type { RegExpExecArray } from "regexp-match-indices/types";
import DynamicHighlightsPlugin from "src/main";
import { SearchQueries } from "src/settings/settings";
import { StyleSpec } from "style-mod";
import { RegExpCursor } from "./regexp-cursor";

// Object pooling for performance optimization
class DecorationPool {
  private decorationCache = new Map<string, Decoration>();

  getDecoration(type: string, className: string, attributes?: Record<string, string>): Decoration {
    const key = `${type}-${className}-${JSON.stringify(attributes || {})}`;
    if (!this.decorationCache.has(key)) {
      let decoration: Decoration;
      if (type === 'mark') {
        decoration = Decoration.mark({ class: className, attributes });
      } else if (type === 'line') {
        decoration = Decoration.line({ attributes: { class: className } });
      } else if (type === 'widget') {
        decoration = Decoration.widget({ widget: new IconWidget(className) });
      } else {
        throw new Error(`Unknown decoration type: ${type}`);
      }
      this.decorationCache.set(key, decoration);
    }
    return this.decorationCache.get(key)!;
  }

  createRange(decoration: Decoration, from: number, to: number): Range<Decoration> {
    // Create a new range object instead of trying to reuse - safer approach
    return decoration.range(from, to);
  }

  cleanup(): void {
    // Periodic cleanup of unused decorations
    if (this.decorationCache.size > 100) {
      // Keep only the most recently used decorations
      const entries = Array.from(this.decorationCache.entries());
      this.decorationCache.clear();
      // Keep last 50 decorations
      entries.slice(-50).forEach(([key, decoration]) => {
        this.decorationCache.set(key, decoration);
      });
    }
  }
}

const decorationPool = new DecorationPool();

export type StaticHighlightOptions = {
  queries: SearchQueries;
  queryOrder: string[];
};

const defaultOptions: StaticHighlightOptions = {
  queries: {},
  queryOrder: [],
};

export const staticHighlightConfig = Facet.define<StaticHighlightOptions, Required<StaticHighlightOptions>>({
  combine(options: readonly StaticHighlightOptions[]) {
    return combineConfig(options, defaultOptions, {
      queries: (a, b) => a || b,
      queryOrder: (a, b) => a || b,
    });
  },
});

const staticHighlighterCompartment = new Compartment();

export function staticHighlighterExtension(plugin: DynamicHighlightsPlugin): Extension {
  let ext: Extension[] = [staticHighlighter];
  let options = plugin.settings.staticHighlighter;
  ext.push(staticHighlightConfig.of(cloneDeep(options)));
  return ext;
}

export interface Styles {
  [selector: string]: StyleSpec;
}

export function buildStyles(plugin: DynamicHighlightsPlugin) {
  let queries = Object.values(plugin.settings.staticHighlighter.queries);
  let styles: Styles = {};
  for (let query of queries) {
    let className = "." + query.class;
    if (!query.color) continue;
    styles[className] = { backgroundColor: query.color };
  }
  let theme = EditorView.theme(styles);
  return theme;
}

class IconWidget extends WidgetType {
  className: string | undefined;

  constructor(className?: string) {
    super();
    this.className = className;
  }

  toDOM() {
    let headerEl = document.createElement("span");
    if (this.className) {
      headerEl.className = this.className; // Fixed: Use className property instead of addClass
    }
    return headerEl;
  }

  ignoreEvent() {
    return true;
  }
}

const staticHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    lineDecorations: DecorationSet;
    groupDecorations: DecorationSet;
    widgetDecorations: DecorationSet;
    cleanupInterval: number | null = null;    constructor(view: EditorView) {
      let { token, line, group, widget } = this.getDeco(view);
      this.decorations = token;
      this.lineDecorations = line;
      this.groupDecorations = group;
      this.widgetDecorations = widget;

      // Schedule periodic cleanup with proper cleanup
      this.cleanupInterval = setInterval(() => {
        decorationPool.cleanup();
      }, 30000);
    }

    // Add cleanup method to properly dispose of the interval
    destroy() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
    }

    update(update: ViewUpdate) {
      let reconfigured = update.startState.facet(staticHighlightConfig) !== update.state.facet(staticHighlightConfig);
      if (update.docChanged || update.viewportChanged || reconfigured) {
        let { token, line, group, widget } = this.getDeco(update.view);
        this.decorations = token;
        this.lineDecorations = line;
        this.groupDecorations = group;
        this.widgetDecorations = widget;
      }
    }

    getDeco(view: EditorView): {
      line: DecorationSet;
      token: DecorationSet;
      group: DecorationSet;
      widget: DecorationSet;
    } {
      let { state } = view,
        tokenDecos: Range<Decoration>[] = [],
        lineDecos: Range<Decoration>[] = [],
        groupDecos: Range<Decoration>[] = [],
        widgetDecos: Range<Decoration>[] = [],
        lineClasses: { [key: number]: string[] } = {},
        queries = Object.values(view.state.facet(staticHighlightConfig).queries);
      for (let part of view.visibleRanges) {
        for (let query of queries) {
          let cursor: RegExpCursor | SearchCursor;
          try {
            if (query.regex) cursor = new RegExpCursor(state.doc, query.query, {}, part.from, part.to);
            else cursor = new SearchCursor(state.doc, query.query, part.from, part.to);
          } catch (err) {
            console.debug(err);
            continue;
          }
          while (!cursor.next().done) {
            let { from, to } = cursor.value;
            let string = state.sliceDoc(from, to).trim();
            const linePos = view.state.doc.lineAt(from)?.from;
            let syntaxNode = syntaxTree(view.state).resolveInner(linePos + 1),
              nodeProps = syntaxNode.type.prop(tokenClassNodeProp),
              excludedSection = ["hmd-codeblock", "hmd-frontmatter"].find(token =>
                nodeProps?.split(" ").includes(token)
              );
            if (excludedSection) continue;
            if (query.mark?.contains("line")) {
              if (!lineClasses[linePos]) lineClasses[linePos] = [];
              lineClasses[linePos].push(query.class);
            }
            if (!query.mark || query.mark?.contains("match")) {
              const markDeco = decorationPool.getDecoration('mark', query.class, { "data-contents": string });
              tokenDecos.push(decorationPool.createRange(markDeco, from, to));
            }
            if (query.mark?.contains("start") || query.mark?.contains("end")) {
              let startDeco = decorationPool.getDecoration('widget', query.class + "-start");
              let endDeco = decorationPool.getDecoration('widget', query.class + "-end");
              if (query.mark?.contains("start")) widgetDecos.push(decorationPool.createRange(startDeco, from, from));
              if (query.mark?.contains("end")) widgetDecos.push(decorationPool.createRange(endDeco, to, to));
            }
            if (query.mark?.contains("group")) {
              let groups;
              if (cursor instanceof RegExpCursor) {
                let match = cursor.value?.match as RegExpExecArray;
                groups = match.indices?.groups;
              }
              groups &&
                Object.entries(groups).forEach(group => {
                  try {
                    let [groupName, [groupFrom, groupTo]] = group;
                    const groupDeco = decorationPool.getDecoration('mark', groupName);
                    groupDecos.push(decorationPool.createRange(groupDeco, linePos + groupFrom, linePos + groupTo));
                  } catch (err) {
                    console.debug(err);
                  }
                });
            }
          }
        }
      }
      Object.entries(lineClasses).forEach(([pos, classes]) => {
        // we use the long form attributes: {class: ... } to avoid a CM6 bug with class:
        // the issue was fixed in obs 0.13.20 but we'll leave it like this until the
        // next public release
        pos = parseInt(pos); // since Object.entries returns keys as strings
        const lineDeco = decorationPool.getDecoration('line', classes.join(" "));
        lineDecos.push(decorationPool.createRange(lineDeco, pos, pos));
      });
      decorationPool.cleanup();
      return {
        line: Decoration.set(lineDecos.sort((a, b) => a.from - b.from)),
        token: Decoration.set(tokenDecos.sort((a, b) => a.from - b.from)),
        group: Decoration.set(groupDecos.sort((a, b) => a.from - b.from)),
        widget: Decoration.set(widgetDecos.sort((a, b) => a.from - b.from)),
      };
    }
  },
  {
    provide: plugin => [
      // these are separated out so that we can set decoration priority
      // it's also much easier to sort the decorations when they're grouped
      EditorView.decorations.of(v => v.plugin(plugin)?.lineDecorations || Decoration.none),
      EditorView.decorations.of(v => v.plugin(plugin)?.groupDecorations || Decoration.none),
      EditorView.decorations.of(v => v.plugin(plugin)?.decorations || Decoration.none),
      EditorView.decorations.of(v => v.plugin(plugin)?.widgetDecorations || Decoration.none),
    ],
  }
);

