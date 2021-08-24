import "leaflet";
import "../node_modules/leaflet/dist/leaflet.css";
import "./assets/main.css";

import {
    Notice,
    MarkdownPostProcessorContext,
    Plugin,
    TFile,
    addIcon,
    Platform,
    WorkspaceLeaf
} from "obsidian";

//Local Imports

import { ObsidianLeafletSettingTab } from "./settings/settings";

import {
    getIcon,
    DEFAULT_SETTINGS,
    getParamsFromSource,
    getMarkerIcon,
    DESCRIPTION_ICON,
    DESCRIPTION_ICON_SVG,
    log,
    BULLSEYE,
    BULLSEYE_ICON_SVG,
    VIEW_ICON_SVG,
    VIEW_ICON,
    VIEW_TYPE,
    MODIFIER_KEY
} from "./utils";
import {
    MapInterface,
    MarkerIcon,
    ObsidianAppData,
    Icon,
    Marker,
    ObsidianLeaflet as ObsidianLeafletImplementation,
    BaseMapType
} from "./@types";

import { LeafletRenderer } from "./renderer";
import { markerDivIcon } from "./map/divicon";
import { LeafletMapView } from "./map/view";

//add commands to app interface
declare module "obsidian" {
    interface App {
        commands: {
            listCommands(): Command[];
            executeCommandById(id: string): void;
            findCommand(id: string): Command;
            commands: { [id: string]: Command };
        };
        keymap: {
            pushScope(scope: Scope): void;
            popScope(scope: Scope): void;
        };
    }
    interface MarkdownPostProcessorContext {
        containerEl: HTMLElement;
    }

    interface MenuItem {
        dom: HTMLDivElement;
    }
}

export default class ObsidianLeaflet
    extends Plugin
    implements ObsidianLeafletImplementation
{
    data: ObsidianAppData;
    markerIcons: MarkerIcon[];
    maps: MapInterface[] = [];
    mapFiles: { file: string; maps: string[] }[] = [];
    watchers: Set<TFile> = new Set();
    Platform = Platform;
    isDesktop = Platform.isDesktopApp;
    isMobile = Platform.isMobileApp;
    isMacOS = Platform.isMacOS;
    get modifierKey() {
        return this.isMacOS ? "Meta" : "Control";
    }
    /* escapeScope: Scope; */

    async onload(): Promise<void> {
        console.log("Loading Obsidian Leaflet v" + this.manifest.version);

        await this.loadSettings();

        addIcon(DESCRIPTION_ICON, DESCRIPTION_ICON_SVG);
        addIcon(BULLSEYE, BULLSEYE_ICON_SVG);
        addIcon(VIEW_ICON, VIEW_ICON_SVG);

        if (this.data.mapViewEnabled) {
            this.addRibbonIcon(VIEW_ICON, "Open Leaflet Map", (evt) => {
                this.app.workspace
                    .getLeaf(evt.getModifierState(MODIFIER_KEY))
                    .setViewState({ type: VIEW_TYPE });
            });

            this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => {
                return new LeafletMapView(leaf, this);
            });
        }

        this.markerIcons = this.generateMarkerMarkup(this.data.markerIcons);

        this.registerMarkdownCodeBlockProcessor(
            "leaflet",
            this.postprocessor.bind(this)
        );

        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {
                if (!file) return;
                if (!this.mapFiles.find(({ file: f }) => f === oldPath)) return;

                this.mapFiles.find(({ file: f }) => f === oldPath).file =
                    file.path;

                await this.saveSettings();
            })
        );
        this.registerEvent(
            this.app.vault.on("delete", async (file) => {
                if (!file) return;
                if (!this.mapFiles.find(({ file: f }) => f === file.path))
                    return;

                this.mapFiles = this.mapFiles.filter(
                    ({ file: f }) => f != file.path
                );

                await this.saveSettings();
            })
        );

        this.addSettingTab(new ObsidianLeafletSettingTab(this.app, this));
    }

    async onunload(): Promise<void> {
        console.log("Unloading Obsidian Leaflet");

        this.maps.forEach((map) => {
            map?.map?.remove();
            let newPre = createEl("pre");
            newPre.createEl("code", {}, (code) => {
                code.innerText = `\`\`\`leaflet\n${map.source}\`\`\``;
                map.el.parentElement.replaceChild(newPre, map.el);
            });
        });

        this.maps = [];
    }

    async postprocessor(
        source: string,
        el: HTMLElement,
        ctx: MarkdownPostProcessorContext
    ): Promise<void> {
        /* try { */
        /** Get Parameters from Source */
        let params = getParamsFromSource(source);

        if (!params.id) {
            new Notice("Obsidian Leaflet maps must have an ID.");
            throw new Error("ID required");
        }
        log(params.verbose, params.id, "Beginning Markdown Postprocessor.");

        const renderer = new LeafletRenderer(this, ctx.sourcePath, el, params);
        const map = renderer.map;

        this.registerMapEvents(map);

        ctx.addChild(renderer);

        /** Add Map to Map Store
         */
        this.maps = this.maps.filter((m) => m.el != el);
        this.maps.push({
            map: map,
            source: source,
            el: el,
            id: params.id
        });

        if (this.mapFiles.find(({ file }) => file == ctx.sourcePath)) {
            this.mapFiles
                .find(({ file }) => file == ctx.sourcePath)
                .maps.push(params.id);
        } else {
            this.mapFiles.push({
                file: ctx.sourcePath,
                maps: [params.id]
            });
        }

        /* } catch (e) {
            console.error(e);
            new Notice("There was an error loading the map.");
            renderError(el, e.message);
        } */
    }
    get configDirectory() {
        if (!this.data.configDirectory) return;
        return `${this.data.configDirectory}/plugins/obsidian-leaflet-plugin`;
    }
    get configFilePath() {
        if (!this.data.configDirectory) return;
        return `${this.configDirectory}/data.json`;
    }
    async loadSettings() {
        this.data = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        if (
            this.configDirectory &&
            (await this.app.vault.adapter.exists(this.configFilePath))
        ) {
            this.data = Object.assign(
                {},
                this.data,
                JSON.parse(
                    await this.app.vault.adapter.read(this.configFilePath)
                )
            );
        }
        this.data.previousVersion = this.manifest.version;
        if (typeof this.data.displayMarkerTooltips === "boolean") {
            this.data.displayMarkerTooltips = this.data.displayMarkerTooltips
                ? "hover"
                : "never";
        }
        if (!this.data.defaultMarker || !this.data.defaultMarker.iconName) {
            this.data.defaultMarker = DEFAULT_SETTINGS.defaultMarker;
            this.data.layerMarkers = false;
        }
        await this.saveSettings();
    }
    async saveSettings() {
        this.maps.forEach((map) => {
            this.data.mapMarkers = this.data.mapMarkers.filter(
                ({ id }) => id != map.id
            );

            this.data.mapMarkers.push({
                ...map.map.toProperties(),
                files: this.mapFiles
                    .filter(({ maps }) => maps.indexOf(map.id) > -1)
                    .map(({ file }) => file)
            });
        });

        /** Only need to save maps with defined marker data */
        this.data.mapMarkers = this.data.mapMarkers.filter(
            ({ markers, overlays }) => markers.length > 0 || overlays.length > 0
        );

        /** Remove maps that haven't been accessed in more than 1 week that are not associated with a file */
        this.data.mapMarkers = this.data.mapMarkers.filter(
            ({ id, files, lastAccessed = Date.now() }) =>
                !id || files.length || Date.now() - lastAccessed <= 6.048e8
        );

        await this.saveData(this.data);

        this.markerIcons = this.generateMarkerMarkup(this.data.markerIcons);

        this.maps.forEach((map) => {
            map.map.updateMarkerIcons();
        });
    }
    async saveData(data: Record<any, any>) {
        if (this.configDirectory) {
            try {
                if (
                    !(await this.app.vault.adapter.exists(this.configDirectory))
                ) {
                    await this.app.vault.adapter.mkdir(this.configDirectory);
                }
                await this.app.vault.adapter.write(
                    this.configFilePath,
                    JSON.stringify(data)
                );
            } catch (e) {
                console.error(e);
                new Notice(
                    "There was an error saving into the configured directory."
                );
            }
        }
        await super.saveData(data);
    }
    generateMarkerMarkup(
        markers: Icon[] = this.data.markerIcons
    ): MarkerIcon[] {
        let ret: MarkerIcon[] = markers.map((marker): MarkerIcon => {
            if (!marker.transform) {
                marker.transform = this.data.defaultMarker.transform;
            }
            if (!marker.iconName) {
                marker.iconName = this.data.defaultMarker.iconName;
            }
            const params =
                marker.layer && !this.data.defaultMarker.isImage
                    ? {
                          transform: marker.transform,
                          mask: getIcon(this.data.defaultMarker.iconName)
                      }
                    : {};
            let node = getMarkerIcon(marker, {
                ...params,
                classes: ["full-width-height"]
            }).node as HTMLElement;
            node.style.color = marker.color
                ? marker.color
                : this.data.defaultMarker.color;

            return {
                type: marker.type,
                html: node.outerHTML,
                icon: markerDivIcon({
                    html: node.outerHTML,
                    className: `leaflet-div-icon`
                })
            };
        });
        const defaultHtml = getMarkerIcon(this.data.defaultMarker, {
            classes: ["full-width-height"],
            styles: {
                color: this.data.defaultMarker.color
            }
        }).html;
        ret.unshift({
            type: "default",
            html: defaultHtml,
            icon: markerDivIcon({
                html: defaultHtml,
                className: `leaflet-div-icon`
            })
        });

        return ret;
    }

    registerMapEvents(map: BaseMapType) {
        this.registerDomEvent(map.contentEl, "dragover", (evt) => {
            evt.preventDefault();
        });
        this.registerDomEvent(map.contentEl, "drop", (evt) => {
            evt.stopPropagation();

            let file = decodeURIComponent(
                evt.dataTransfer.getData("text/plain")
            )
                .split("file=")
                .pop();
            const latlng = map.leafletInstance.mouseEventToLatLng(evt);
            const loc: [number, number] = [latlng.lat, latlng.lng];

            let marker = map.createMarker(
                map.defaultIcon.type,
                loc,
                undefined,
                file
            );
            marker.leafletInstance.closeTooltip();
        });

        map.on("marker-added", async (marker: Marker) => {
            marker.leafletInstance.closeTooltip();
            marker.leafletInstance.unbindTooltip();
            this.maps
                .filter(
                    ({ id, map: m }) =>
                        id == map.id && m.contentEl != map.contentEl
                )
                .forEach((map) => {
                    map.map.addMarker(marker.toProperties());
                });
            await this.saveSettings();
        });

        map.on("marker-dragging", (marker: Marker) => {
            this.maps
                .filter(
                    ({ id, map: m }) =>
                        id == map.id && m.contentEl != map.contentEl
                )
                .forEach((otherMap) => {
                    let existingMarker = otherMap.map.markers.find(
                        (m) => m.id == marker.id
                    );
                    if (!existingMarker) return;

                    existingMarker.setLatLng(
                        marker.leafletInstance.getLatLng()
                    );
                });
        });

        map.on("marker-data-updated", async (marker: Marker) => {
            await this.saveSettings();
            this.maps
                .filter(
                    ({ id, map: m }) =>
                        id == map.id && m.contentEl != map.contentEl
                )
                .forEach((map) => {
                    let existingMarker = map.map.markers.find(
                        (m) => m.id == marker.id
                    );
                    if (!existingMarker) return;

                    existingMarker.setLatLng(
                        marker.leafletInstance.getLatLng()
                    );
                });
        });

        map.on("marker-deleted", (marker) => {
            const otherMaps = this.maps.filter(
                ({ id, map: m }) => id == map.id && m.contentEl != map.contentEl
            );
            for (let { map } of otherMaps) {
                map.removeMarker(marker);
            }
        });

        map.on("marker-updated", (marker) => {
            const otherMaps = this.maps.filter(
                ({ id, map: m }) => id == map.id && m.contentEl != map.contentEl
            );
            for (let { map } of otherMaps) {
                map.updateMarker(marker);
            }
        });
    }
}
