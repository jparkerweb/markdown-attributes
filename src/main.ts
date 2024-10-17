import { MarkdownPostProcessorContext, Plugin, TFile, MarkdownRenderer } from "obsidian";
import Processor from "./processor";
import { inlinePlugin } from "./live-preview";

export default class MarkdownAttributes extends Plugin {
    parsing: Map<MarkdownPostProcessorContext, string> = new Map();
    async onload(): Promise<void> {
        console.log(`Markdown Attributes v${this.manifest.version} loaded.`);

        this.registerMarkdownPostProcessor(this.postprocessor.bind(this));
        this.registerEditorExtension(inlinePlugin());

        // Register the deferred renderer
        this.registerMarkdownCodeBlockProcessor("attributes", this.deferredRenderer.bind(this));
    }

    async postprocessor(
        element: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ) {
        const child = element.firstElementChild;
        if (!child) return;
        let str: string;

        /** Code blocks have to be handled separately because Obsidian does not
         *  include any text past the language.
         *
         *  Unfortunately this also means that changes to the code block attributes
         *  require reloading the note to take effect because they do not trigger the postprocessor.
         */
        if (child instanceof HTMLPreElement) {
            /** If getSectionInfo returns null, stop processing. */
            if (!ctx.getSectionInfo(element)) return;

            /** Pull the Section data. */
            const { lineStart } = ctx.getSectionInfo(element);

            const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
            if (!(file instanceof TFile)) return;
            const text = await this.app.vault.cachedRead(file);

            /** Get the source for this element. Only look at the top line for code blocks. */
            let source = text.split("\n").slice(lineStart, lineStart + 1);
            str = source.join("\n");
            /** Test if the element contains attributes. */
            if (!Processor.BASE_RE.test(str)) return;

            /** Pull the matched string and add it to the child so the Processor catches it. */
            let [attribute_string] = str.match(Processor.BASE_RE) ?? [];
            child.prepend(new Text(attribute_string));
        }

        /**
         * Table elements and Mathjax elements should check the next line in the source to see if it is a single block attribute,
         * because those block attributes are not applied to the table.
         */
        if (
            child instanceof HTMLTableElement ||
            (child.hasClass("math") && child.hasClass("math-block")) ||
            child.hasClass("callout")
        ) {
            if (!ctx.getSectionInfo(element)) return;

            /** Pull the Section data. */
            const { text, lineEnd } = ctx.getSectionInfo(element);

            /** Callouts include the block level attribute */
            const adjustment = child.hasClass("callout") ? 0 : 1;

            /** Get the source for this element. */
            let source = (
                text
                    .split("\n")
                    .slice(lineEnd + adjustment, lineEnd + adjustment + 1) ?? []
            ).shift();

            /** Test if the element contains attributes. */
            if (
                source &&
                source.length &&
                Processor.ONLY_RE.test(source.trim())
            ) {
                /** Pull the matched string and add it to the child so the Processor catches it. */
                let [attribute_string] = source.match(Processor.ONLY_RE) ?? [];
                child.prepend(new Text(attribute_string));

                str = element.innerText;
            }
        }

        /**
         * If the element is a <p> and the text is *only* an attribute, it was used as a block attribute
         * and should be removed.
         */
        if (child instanceof HTMLParagraphElement && !child.childElementCount) {
            if (Processor.ONLY_RE.test(child.innerText.trim())) {
                child.detach();
                return;
            }
        }

        /** Test if the element contains attributes. */
        if (!Processor.BASE_RE.test(str ?? element.innerText)) return;

        /** Parse the element using the Processor. */
        if (!(child instanceof HTMLElement)) return;
        Processor.parse(child);
    }

    async deferredRenderer(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        // Parse the source for attributes
        const parsed = Processor.parse(source);

        // Create a temporary div to render the markdown
        const tempDiv = createDiv();
        await MarkdownRenderer.renderMarkdown(source, tempDiv, ctx.sourcePath, this);

        // Apply attributes to the rendered elements
        for (const item of parsed) {
            const { attributes, text } = item;
            const elements = tempDiv.querySelectorAll(`[data-original-text="${text}"]`);
            elements.forEach(element => {
                if (element instanceof HTMLElement) {
                    for (const [key, value] of attributes) {
                        if (key === "class") {
                            element.addClass(value);
                        } else if (!value) {
                            element.setAttribute(key, "true");
                        } else {
                            element.setAttribute(key, value);
                        }
                    }
                }
            });
        }

        // Move the rendered content to the final element
        el.appendChild(tempDiv);
    }

    async onunload() {
        console.log("Markdown Attributes unloaded");
    }
}
