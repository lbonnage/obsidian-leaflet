import {
    App,
    MarkdownView,
    Notice,
    parseYaml,
    setIcon,
    TextComponent,
    TFile,
    TFolder,
    Vault
} from "obsidian";
import Color from "color";

import { parse as parseCSV } from "papaparse";

import { BaseMapType, BlockParameters } from "src/@types";
import { LAT_LONG_DECIMALS, OVERLAY_TAG_REGEX } from "./constants";
import { DESCRIPTION_ICON } from ".";
import { locale } from "moment";

export function formatNumber(number: number, digits: number) {
    return new Intl.NumberFormat(locale(), {
        style: "decimal",
        maximumFractionDigits: digits
    }).format(number);
}

export function formatLatLng(latlng: L.LatLng) {
    return {
        lat: formatNumber(latlng.lat, LAT_LONG_DECIMALS),
        lng: formatNumber(latlng.lng, LAT_LONG_DECIMALS)
    };
}

export async function copyToClipboard(loc: L.LatLng): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        navigator.clipboard
            .writeText(
                `${formatNumber(loc.lat, LAT_LONG_DECIMALS)}, ${formatNumber(
                    loc.lng,
                    LAT_LONG_DECIMALS
                )}`
            )
            .then(() => {
                new Notice("Coordinates copied to clipboard.");
                resolve();
            })
            .catch(() => {
                new Notice(
                    "There was an error trying to copy coordinates to clipboard."
                );
                reject();
            });
    });
}

export function renderError(el: HTMLElement, error: string): void {
    let pre = createEl("pre", { attr: { id: "leaflet-error" } });
    pre.setText(`\`\`\`leaflet
There was an error rendering the map:

${error}
\`\`\``);
    el.replaceWith(pre);
}

export function log(verbose: boolean, id: string, message: string) {
    if (!verbose) return;
    console.log(`Obsidian Leaflet Map ${id}: ${message}`);
}

export function getHex(color: string): string {
    return Color(color).hex();
}

export function getImageDimensions(url: string): Promise<any> {
    return new Promise(function (resolved, reject) {
        var i = new Image();
        i.onload = function () {
            const { width, height } = i;
            i.detach();
            resolved({ w: width, h: height });
        };
        i.onerror = () => {
            new Notice("There was an issue getting the image dimensions.");
            reject();
        };

        i.src = url;
    });
}

export function getId() {
    return "ID_xyxyxyxyxyxy".replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0,
            v = c == "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export { compare as compareVersions } from "compare-versions";

export const setValidationError = function (
    textInput: TextComponent,
    message?: string
) {
    textInput.inputEl.addClass("is-invalid");
    if (message) {
        textInput.inputEl.parentElement.addClasses([
            "has-invalid-message",
            "unset-align-items"
        ]);
        textInput.inputEl.parentElement.parentElement.addClass(
            ".unset-align-items"
        );
        let mDiv = textInput.inputEl.parentElement.querySelector(
            ".invalid-feedback"
        ) as HTMLDivElement;

        if (!mDiv) {
            mDiv = createDiv({ cls: "invalid-feedback" });
        }
        mDiv.innerText = message;
        mDiv.insertAfter(textInput.inputEl);
    }
};
export const removeValidationError = function (textInput: TextComponent) {
    textInput.inputEl.removeClass("is-invalid");
    textInput.inputEl.parentElement.removeClasses([
        "has-invalid-message",
        "unset-align-items"
    ]);
    textInput.inputEl.parentElement.parentElement.removeClass(
        ".unset-align-items"
    );

    if (textInput.inputEl.parentElement.children[1]) {
        textInput.inputEl.parentElement.removeChild(
            textInput.inputEl.parentElement.children[1]
        );
    }
};

export function getHeight(view: MarkdownView, height: string): string {
    try {
        if (!/\d+(px|%)/.test(height))
            throw new Error("Unparseable height provided.");
        if (/\d+%/.test(height)) {
            let [, perc] = height.match(/(\d+)%/);

            let node = view.previewMode.containerEl.querySelector(
                ".markdown-preview-view"
            );
            let computedStyle = getComputedStyle(node);
            let clHeight = node.clientHeight; // height with padding

            clHeight -=
                parseFloat(computedStyle.paddingTop) +
                parseFloat(computedStyle.paddingBottom);

            height = `${(clHeight * Number(perc)) / 100}px`;
        }
    } catch (e) {
        new Notice(
            "There was a problem with the provided height. Using 500px."
        );
        height = "500px";
    } finally {
        return height;
    }
}

export async function getBlob(url: string, app: App) {
    let response, blob: Blob, extension: string, alias: string;
    url = decodeURIComponent(url);
    try {
        if (/https?:/.test(url)) {
            //url
            response = await fetch(url);
            blob = await response.blob();
        } else if (/obsidian:\/\/open/.test(url)) {
            //obsidian link
            let [, filePath] = url.match(/\?vault=[\s\S]+?&file=([\s\S]+)/);

            filePath = decodeURIComponent(filePath);
            let file = app.vault.getAbstractFileByPath(filePath);
            if (!file) throw new Error();
            extension = (file as TFile).extension;
            let buffer = await app.vault.readBinary(file as TFile);
            blob = new Blob([new Uint8Array(buffer)]);
        } else {
            //file exists on disk;
            let file = app.metadataCache.getFirstLinkpathDest(
                parseLink(url).split("|").shift(),
                ""
            );
            if (!file) throw new Error();

            extension = file.extension;

            let buffer = await app.vault.readBinary(file);
            blob = new Blob([new Uint8Array(buffer)]);
            alias = (
                url.includes("|") ? url.split("|").pop() : file.basename
            ).replace(/(\[|\])/g, "");
        }
    } catch (e) {
        console.error(e);
    }
    return { blob, id: encodeURIComponent(url), alias, extension };
}

export function parseLink(link: string) {
    return link.replace(/(\[|\])/g, "");
}

export async function getImmutableItems(
    /* source: string */
    app: App,
    markers: string[] = [],
    commandMarkers: string[] = [],
    markerTags: string[][] = [],
    markerFiles: string[] = [],
    markerFolders: string[] = [],
    linksTo: string[] = [],
    linksFrom: string[] = [],
    overlayTag: string,
    overlayColor: string
): Promise<{
    markers: [
        type: string,
        lat: number,
        long: number,
        link: string,
        layer: string,
        command: boolean,
        id: string,
        desc: string,
        minZoom: number,
        maxZoom: number
    ][];
    overlays: [
        color: string,
        loc: [number, number],
        length: string,
        desc: string,
        id: string
    ][];
    files: Map<TFile, Map<string, string>>;
}> {
    return new Promise(async (resolve, reject) => {
        let markersToReturn: [
                type: string,
                lat: number,
                long: number,
                link: string,
                layer: string,
                command: boolean,
                id: string,
                desc: string,
                minZoom: number,
                maxZoom: number
            ][] = [],
            overlaysToReturn: [
                color: string,
                loc: [number, number],
                length: string,
                desc: string,
                id: string
            ][] = [];

        for (let marker of markers) {
            /* type, lat, long, link, layer, */
            const { data } = parseCSV<string>(marker);
            if (!data.length) {
                new Notice("No data");
                continue;
            }

            let [type, lat, long, link, layer, minZoom, maxZoom] = data[0];

            if (!type || !type.length || type === "undefined") {
                type = "default";
            }
            if (!lat || !lat.length || isNaN(Number(lat))) {
                new Notice("Could not parse latitude");
                continue;
            }
            if (!long || !long.length || isNaN(Number(long))) {
                new Notice("Could not parse longitude");
                continue;
            }
            let min, max;
            if (isNaN(Number(minZoom))) {
                min = undefined;
            } else {
                min = Number(minZoom);
            }
            if (isNaN(Number(maxZoom))) {
                max = undefined;
            } else {
                max = Number(maxZoom);
            }

            if (!link || !link.length || link === "undefined") {
                link = undefined;
            } else if (/\[\[[\s\S]+\]\]/.test(link)) {
                //obsidian wiki-link
                link = parseLink(link);
            }

            if (!layer || !layer.length || layer === "undefined") {
                layer = undefined;
            }
            markersToReturn.push([
                type,
                Number(lat),
                Number(long),
                link,
                layer,
                false,
                null,
                null,
                min,
                max
            ]);
        }

        for (let marker of commandMarkers) {
            /* type, lat, long, link, layer, */
            const { data } = parseCSV<string>(marker);
            if (!data.length) {
                new Notice("No data");
                continue;
            }

            let [type, lat, long, link, layer, minZoom, maxZoom] = data[0];

            if (!type || !type.length || type === "undefined") {
                type = "default";
            }
            if (!lat || !lat.length || isNaN(Number(lat))) {
                new Notice("Could not parse latitude");
                continue;
            }
            if (!long || !long.length || isNaN(Number(long))) {
                new Notice("Could not parse longitude");
                continue;
            }
            let min, max;
            if (isNaN(Number(minZoom))) {
                min = undefined;
            } else {
                min = Number(minZoom);
            }
            if (isNaN(Number(maxZoom))) {
                max = undefined;
            } else {
                max = Number(maxZoom);
            }

            if (!link || !link.length || link === "undefined") {
                link = undefined;
            } else if (/\[\[[\s\S]+\]\]/.test(link)) {
                //obsidian wiki-link
                link = parseLink(link);
            }

            //find command id
            const commands = app.commands.listCommands();
            const { id } = commands.find(
                ({ name: n, id }) => n == link || id == link
            );

            if (!layer || !layer.length || layer === "undefined") {
                layer = undefined;
            }
            markersToReturn.push([
                type,
                Number(lat),
                Number(long),
                id,
                layer,
                true,
                null,
                null,
                min,
                max
            ]);
        }
        let watchers = new Map<TFile, Map<string, string>>();
        if (
            markerFiles.length ||
            markerFolders.length ||
            markerTags.length ||
            linksTo.length ||
            linksFrom
        ) {
            let files = new Set(markerFiles);

            for (let path of markerFolders) {
                let abstractFile = app.vault.getAbstractFileByPath(path);
                if (!abstractFile) continue;
                if (abstractFile instanceof TFile) files.add(path);
                if (abstractFile instanceof TFolder) {
                    Vault.recurseChildren(abstractFile, (file) => {
                        if (file instanceof TFile) files.add(file.path);
                    });
                }
            }
            //get cache
            //error is thrown here because plugins isn't exposed on Obsidian App
            //@ts-expect-error
            const cache = app.plugins.plugins.dataview?.index;
            if (cache) {
                if (markerTags.length > 0) {
                    const tagSet = new Set();
                    for (let tags of markerTags) {
                        const filtered = tags
                            .filter((tag) => tag)
                            .map((tag) => {
                                if (!tag.includes("#")) {
                                    tag = `#${tag}`;
                                }
                                return cache.tags.getInverse(tag.trim());
                            });
                        if (!filtered.length) continue;
                        filtered
                            .reduce(
                                (a, b) =>
                                    new Set(
                                        [...b].filter(
                                            Set.prototype.has,
                                            new Set(a)
                                        )
                                    )
                            )
                            .forEach(tagSet.add, tagSet);
                    }

                    if (files.size) {
                        files = new Set([...files].filter(tagSet.has, tagSet));
                    } else {
                        tagSet.forEach(files.add, files);
                    }
                }
                for (let link of linksTo) {
                    //invMap -> linksTo
                    const file = app.metadataCache.getFirstLinkpathDest(
                        parseLink(link),
                        ""
                    );
                    if (!file) continue;

                    const links = cache.links.invMap.get(file.path);

                    if (!links) continue;

                    links.forEach(files.add, files);
                }
                for (let link of linksFrom) {
                    //map -> linksFrom
                    const file = app.metadataCache.getFirstLinkpathDest(
                        parseLink(link),
                        ""
                    );
                    if (!file) continue;

                    const links = cache.links.map.get(file.path);

                    if (!links) continue;

                    links.forEach(files.add, files);
                }
            } else {
                const errors: string[] = [];
                if (markerTags.length) {
                    errors.push("markerTags");
                }
                if (linksTo.length) {
                    errors.push("linksTo");
                }
                if (linksFrom.length) {
                    errors.push("linksFrom");
                }
                if (errors.length)
                    new Notice(
                        `The \`${errors.reduce((res, k, i) =>
                            [res, k].join(
                                i ===
                                    errors.reduce((res, k, i) =>
                                        [res, k].join(
                                            i === errors.length - 1
                                                ? " and "
                                                : ", "
                                        )
                                    ).length -
                                        1
                                    ? " and "
                                    : ", "
                            )
                        )}\` field${
                            errors.length > 2 ? "s" : ""
                        } can only be used with the Dataview plugin installed.`
                    );
            }

            for (let path of files) {
                const file = app.metadataCache.getFirstLinkpathDest(
                    parseLink(path),
                    ""
                );
                const linkText = app.metadataCache.fileToLinktext(
                    file,
                    "",
                    true
                );

                const idMap = new Map<string, string>();
                if (
                    !file ||
                    !(file instanceof TFile) ||
                    file.extension !== "md"
                )
                    continue;
                let { frontmatter } =
                    app.metadataCache.getFileCache(file) ?? {};

                if (
                    !frontmatter ||
                    (!frontmatter.location && !frontmatter.mapoverlay)
                )
                    continue;

                const id = getId();

                if (frontmatter.location) {
                    let locations = frontmatter.location;
                    if (locations.length && !(locations[0] instanceof Array)) {
                        locations = [locations];
                    }
                    for (const location of locations) {
                        let err = false,
                            [lat, long] = location;

                        try {
                            lat =
                                typeof lat === "number"
                                    ? lat
                                    : Number(lat?.split("%").shift());
                            long =
                                typeof long === "number"
                                    ? long
                                    : Number(long?.split("%").shift());
                        } catch (e) {
                            err = true;
                        }

                        if (err || isNaN(lat) || isNaN(long)) {
                            new Notice(
                                "Could not parse location in " + file.basename
                            );
                            continue;
                        }

                        let min, max;
                        if (frontmatter.mapzoom) {
                            let [minZoom, maxZoom] = frontmatter.mapzoom;
                            if (isNaN(Number(minZoom))) {
                                min = undefined;
                            } else {
                                min = Number(minZoom);
                            }
                            if (isNaN(Number(maxZoom))) {
                                max = undefined;
                            } else {
                                max = Number(maxZoom);
                            }
                        }

                        markersToReturn.push([
                            frontmatter.mapmarker || "default",
                            lat,
                            long,
                            linkText,
                            undefined,
                            false,
                            id,
                            null,
                            min,
                            max
                        ]);
                    }
                    /* watchers.set(file, watchers.get(file).add(id)); */
                    idMap.set("marker", id);
                }

                if (frontmatter.mapmarkers) {
                    const id = getId();
                    frontmatter.mapmarkers.forEach(
                        ([type, location, description, minZoom, maxZoom]: [
                            type: string,
                            location: number[],
                            description: string,
                            minZoom: number,
                            maxZoom: number
                        ]) => {
                            let min, max;
                            if (isNaN(Number(minZoom))) {
                                min = undefined;
                            } else {
                                min = Number(minZoom);
                            }
                            if (isNaN(Number(maxZoom))) {
                                max = undefined;
                            } else {
                                max = Number(maxZoom);
                            }
                            markersToReturn.push([
                                type || "default",
                                location[0],
                                location[1],
                                linkText,
                                undefined,
                                false,
                                id,
                                description,
                                min,
                                max
                            ]);
                        }
                    );
                    idMap.set("mapmarkers", id);
                }

                if (frontmatter.mapoverlay) {
                    const arr =
                        frontmatter.mapoverlay[0] instanceof Array
                            ? frontmatter.mapoverlay
                            : [frontmatter.mapoverlay];
                    arr.forEach(
                        ([
                            color = overlayColor ?? "blue",
                            loc = [0, 0],
                            length = "1 m",
                            desc
                        ]: [
                            color: string,
                            loc: number[],
                            length: string,
                            desc: string
                        ]) => {
                            const match = length.match(OVERLAY_TAG_REGEX);
                            if (!match) {
                                new Notice(
                                    `Could not parse map overlay length in ${file.name}. Please ensure it is in the format: <distance> <unit>`
                                );
                                return;
                            }
                            overlaysToReturn.push([
                                color,
                                loc as [number, number],
                                length,
                                desc ?? `${file.basename} overlay`,
                                id
                            ]);
                        }
                    );
                    idMap.set("overlay", id);
                }

                if (overlayTag in frontmatter) {
                    const match =
                        frontmatter[overlayTag].match(OVERLAY_TAG_REGEX);
                    if (!match) {
                        new Notice(
                            `Could not parse ${overlayTag} in ${file.name}. Please ensure it is in the format: <distance> <unit>`
                        );
                        continue;
                    }

                    let location = frontmatter.location;
                    if (!location) continue;
                    if (
                        location instanceof Array &&
                        !(location[0] instanceof Array)
                    ) {
                        location = [location];
                    }
                    overlaysToReturn.push([
                        overlayColor,
                        location[0],
                        frontmatter[overlayTag],
                        `${file.basename}: ${overlayTag}`,
                        id
                    ]);

                    idMap.set("overlayTag", id);
                }
                watchers.set(file, idMap);
            }
        }
        resolve({
            markers: markersToReturn,
            overlays: overlaysToReturn,
            files: watchers
        });
    });
}
type MarkerType =
    | "marker"
    | "markerFile"
    | "markerFolder"
    | "markerTag"
    | "commandMarker";

/** Parses source block and returns an object of block parameters
 * 1. First, it tries to parse the source as YAML. If the YAML parser fails, it tries to parse it manually.
 * 2. Next, it pulls out multiple images defined in the source. If there are multiple image tags, YAML will return only the last,
 * so it detects that to return them all correctly.
 * 3. Next, it pulls out markers defined in the source block. This is clunky to support previous version's syntax, but works.
 */
export function getParamsFromSource(source: string): BlockParameters {
    let params: BlockParameters = {};

    /** Pull out links */

    const links = source.match(/\[\[([^\[\]]*?)\]\]/g) ?? [];
    for (let link of links) {
        source = source.replace(
            link,
            `LEAFLET_INTERNAL_LINK_${links.indexOf(link)}`
        );
    }

    /** Pull out tags */

    try {
        params = parseYaml(source);
    } catch (e) {
        params = Object.fromEntries(
            source.split("\n").map((l) => l.split(/:\s?/))
        );
    } finally {
        if (!params) params = {};
        let image: string[], layers: string[];

        if (links.length) {
            let stringified = JSON.stringify(params);

            for (let link of links) {
                stringified = stringified.replace(
                    `LEAFLET_INTERNAL_LINK_${links.indexOf(link)}`,
                    link
                );
                source = source.replace(
                    `LEAFLET_INTERNAL_LINK_${links.indexOf(link)}`,
                    link
                );
            }
            params = JSON.parse(stringified);
        }

        /** Get Images from Parameters */
        if ((source.match(/^\bimage\b:[\s\S]*?$/gm) ?? []).length > 1) {
            layers = (source.match(/^\bimage\b:([\s\S]*?)$/gm) || []).map(
                (p) => p.split("image: ")[1]
            );
        }

        if (typeof params.image === "string") {
            image = [params.image];
        } else if (params.image instanceof Array) {
            image = [...params.image];
        } else {
            image = ["real"];
        }

        params.layers = layers ?? [...image];

        params.image = params.layers[0];

        let obj: {
            marker: string[];
            markerFile: string[];
            markerFolder: string[];
            markerTag: string[][];
            commandMarker: string[];
            geojson: string[];
            linksTo: string[];
            linksFrom: string[];
        } = {
            marker: [],
            markerFile: [],
            markerFolder: [],
            markerTag: [],
            commandMarker: [],
            geojson: [],
            linksTo: [],
            linksFrom: []
        };

        if (
            /* /(command)?[mM]arker(File|Folder|Tag)?:/ */ new RegExp(
                `(${Object.keys(obj).join("|")})`
            ).test(source)
        ) {
            //markers defined in code block;

            //Pull Markers

            Object.keys(obj).forEach((type: MarkerType) => {
                let r = new RegExp(`^\\b${type}\\b:\\s?([\\s\\S]*?)$`, "gm");

                switch (type) {
                    case "markerTag": {
                        if ((source.match(r) || []).length > 1) {
                            //defined separately
                            obj[type] = (source.match(r) || []).map((p) =>
                                p
                                    .split(new RegExp(`(?:${type}):\\s?`))[1]
                                    ?.trim()
                                    .split(/,\s?/)
                            );
                        } else if (params[type] instanceof Array) {
                            obj[type] = (
                                params[type] as string[] | string[][]
                            ).map((param: string | string[]) => {
                                if (param instanceof Array) return param;
                                return [param];
                            });
                        } else if (params[type] !== undefined) {
                            obj[type] = [[params[type] as string]];
                        }
                        break;
                    }
                    case "markerFile": {
                        if ((source.match(r) || []).length > 1) {
                            //defined separately
                            obj[type] = (source.match(r) || []).map((p) =>
                                p
                                    .split(new RegExp(`(?:${type}):\\s?`))[1]
                                    ?.trim()
                            );
                        } else if (params[type] instanceof Array) {
                            obj[type] = (params[type] as string[]).flat(
                                2
                            ) as string[];
                        } else if (params[type] !== undefined) {
                            obj[type] = [params[type] as string];
                        }
                        break;
                    }
                    default: {
                        if ((source.match(r) || []).length > 1) {
                            //defined separately
                            obj[type] = (source.match(r) || []).map((p) =>
                                p
                                    .split(new RegExp(`(?:${type}):\\s?`))[1]
                                    ?.trim()
                            );
                        } else if (params[type] instanceof Array) {
                            obj[type] = params[type] as string[];
                        } else if (params[type] !== undefined) {
                            obj[type] = [params[type] as string];
                        }
                    }
                }
            });
        }
        Object.assign(params, obj);

        return params;
    }
}

export function getGroupSeparator(locale: string) {
    const numberWithDecimalSeparator = 1000.1;
    return Intl.NumberFormat(locale)
        .formatToParts(numberWithDecimalSeparator)
        .find((part) => part.type === "group").value;
}

export function catchError(
    target: BaseMapType,
    name: string,
    descriptor: PropertyDescriptor
) {
    const original = descriptor.value;
    if (typeof original === "function") {
        descriptor.value = function (...args: any[]) {
            try {
                return original.apply(this, args);
            } catch (e) {
                //throw error here
                console.error(target, name, e, original);
                renderError(
                    this.contentEl?.parentElement ?? this.contentEl,
                    e.message
                );
            }
        };
    }
}

export function catchErrorAsync(
    target: BaseMapType,
    name: string,
    descriptor: PropertyDescriptor
) {
    const original = descriptor.value;
    if (typeof original === "function") {
        descriptor.value = async function (...args: any[]) {
            try {
                return await original.apply(this, args);
            } catch (e) {
                //throw error here
                console.error(target, name, e, original);
                renderError(
                    this.contentEl?.parentElement ?? this.contentEl,
                    e.message
                );
            }
        };
    }
}

export function buildTooltip(
    title: string,
    { icon, description }: { icon?: boolean; description?: string }
) {
    let display: HTMLDivElement = createDiv({
        attr: { style: "text-align: left;" }
    });
    const titleEl = display.createDiv({
        attr: {
            style: "display: flex; justify-content: space-between;"
        }
    });
    const labelEl = titleEl.createEl("label", {
        text: title,
        attr: {
            style: "text-align: left;"
        }
    });
    if (icon) {
        setIcon(
            titleEl.createDiv({
                attr: {
                    style: "margin-left: 0.5rem;"
                }
            }),
            DESCRIPTION_ICON
        );
    }
    if (description) {
        labelEl.setAttr("style", "font-weight: bolder; text-align: left;");
        display.createEl("p", {
            attr: {
                style: "margin: 0.25rem 0; text-align: left;"
            },
            text: description
        });
    }
    return display;
}
