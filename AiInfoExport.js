#target illustrator

(function () {

    if (app.documents.length === 0) {
        alert("No document open.");
        return;
    }
    var doc = app.activeDocument;

    if (doc.layers.length === 0) {
        alert("The document has no layers.");
        return;
    }

    // -------------------------
    // 1) LAYER + SIZE SELECTION
    // -------------------------
    var layerNames = [];
    for (var i = 0; i < doc.layers.length; i++) {
        var ln = doc.layers[i].name;
        if (!ln || ln === "") ln = "Layer " + (i + 1);
        layerNames.push(ln);
    }

    var dlg = new Window("dialog", "Export JSON + Thumbnails");
    dlg.orientation = "column";
    dlg.alignChildren = "fill";

    dlg.add("statictext", undefined, "Export objects from layer:");
    var ddLayer = dlg.add("dropdownlist", undefined, layerNames);
    ddLayer.selection = 0;

    dlg.add("statictext", undefined, "Thumbnail size (pixels):");
    var ddSize = dlg.add("dropdownlist", undefined, ["64", "128", "256"]);
    ddSize.selection = 1; // default 128

    var gBtns = dlg.add("group");
    gBtns.alignment = "right";
    gBtns.add("button", undefined, "OK", { name: "ok" });
    gBtns.add("button", undefined, "Cancel", { name: "cancel" });

    if (dlg.show() !== 1) return;

    var layer     = doc.layers[ddLayer.selection.index];
    var thumbSize = parseInt(ddSize.selection.text, 10);

    // We'll export GroupItem + PathItem that are direct children of this layer.
    if (!layer) {
        alert("Invalid layer.");
        return;
    }

    // -------------------------
    // 2) ACTIVE ARTBOARD (RELATIVE COORDS)
    // -------------------------
    var activeAbIndex = doc.artboards.getActiveArtboardIndex();
    var ab     = doc.artboards[activeAbIndex];
    var abRect = ab.artboardRect; // [left, top, right, bottom]
    var abLeft = abRect[0];
    var abTop  = abRect[1];
    var abName = ab.name;

    // -------------------------
    // 3) OUTPUT FOLDER + JSON FILE
    // -------------------------
    var outFolder = Folder.selectDialog("Select output folder (JSON + thumbnails)");
    if (!outFolder) return;

    var thumbFolder = new Folder(outFolder.fsName + "/thumbnails");
    if (!thumbFolder.exists) thumbFolder.create();

    var jsonFile = new File(outFolder.fsName + "/export.json");
    if (!jsonFile.open("w")) {
        alert("Could not create JSON file.");
        return;
    }

    function escJSON(str) {
        if (!str) str = "";
        return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    }

    // -------------------------
    // SIMPLE HASH FOR SIGNATURE
    // -------------------------
    function simpleHash(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = (h * 31 + str.charCodeAt(i)) & 0x7FFFFFFF;
        }
        return h.toString(16); // hex string
    }

    /**
     * Build a geometry "fingerprint" for a collection of pageItems,
     * ignoring absolute position (translation-invariant).
     * items: Array of PathItem / PlacedItem / TextFrame, etc.
     */
    function computeSignatureForItems(items) {
        var parts = [];

        var baseX = null;
        var baseY = null;

        try {
            // 1) Find a reference point: first PathItem's first anchor
            for (var i = 0; i < items.length && baseX === null; i++) {
                var it0 = items[i];
                if (it0.typename === "PathItem" && it0.pathPoints.length > 0) {
                    var pt0 = it0.pathPoints[0].anchor;
                    baseX = pt0[0];
                    baseY = pt0[1];
                }
            }

            // If no paths, fallback to just types
            if (baseX === null || baseY === null) {
                var fallback = [];
                for (var j = 0; j < items.length; j++) {
                    fallback.push(items[j].typename);
                }
                return simpleHash(fallback.join("|"));
            }

            // 2) Iterate all items and record geometry relative to baseX/baseY
            for (var k = 0; k < items.length; k++) {
                var it = items[k];

                if (it.typename === "PathItem") {
                    var p = it;
                    parts.push("P");
                    parts.push(p.closed ? "1" : "0");
                    parts.push("#" + p.pathPoints.length);

                    for (var m = 0; m < p.pathPoints.length; m++) {
                        var pt = p.pathPoints[m];
                        var a = pt.anchor;

                        var nx = a[0] - baseX;
                        var ny = a[1] - baseY;

                        parts.push(nx.toFixed(2) + "," + ny.toFixed(2));
                    }
                }
                else if (it.typename === "PlacedItem") {
                    parts.push("I");
                    try {
                        if (it.file && it.file.name) {
                            parts.push(it.file.name);
                        }
                    } catch (ePl) {}
                }
                else if (it.typename === "TextFrame") {
                    parts.push("T");
                    try {
                        parts.push("len=" + (it.contents ? it.contents.length : 0));
                    } catch (eTx) {}
                }
                else {
                    parts.push("X" + it.typename);
                }
            }

        } catch (e) {
            // partial signature is still deterministic
        }

        var sigString = parts.join("|");
        return simpleHash(sigString);
    }

    var jsonLines = [];
    var exported  = 0;
    var skipped   = 0;

    // -------------------------
    // 4) BUILD LIST OF EXPORTABLE OBJECTS (GROUP + PATH)
    // -------------------------
    // We respect stacking order using layer.pageItems
    var layerItems = layer.pageItems;
    var exportItems = []; // { node: PageItem, typename: "GroupItem"/"PathItem" }

    for (var pi = 0; pi < layerItems.length; pi++) {
        var it = layerItems[pi];
        if (it.typename === "GroupItem" || it.typename === "PathItem") {
            exportItems.push(it);
        }
    }

    if (exportItems.length === 0) {
        alert("Selected layer has no top-level groups or paths.");
        jsonFile.close();
        return;
    }

    // -------------------------
    // 5) PROCESS EACH EXPORT ITEM
    // -------------------------
    for (var idx = 0; idx < exportItems.length; idx++) {

        var node = exportItems[idx];

        if (!node || node.locked || node.hidden) {
            skipped++;
            continue;
        }

        // For GroupItem we can check empty group
        if (node.typename === "GroupItem" && node.pageItems.length === 0) {
            skipped++;
            continue;
        }

        var tmpABIndex = null;
        var prevLayerVisible = [];
        var prevHidden = [];

        try {
            var gb = node.geometricBounds;
            if (!gb || gb.length !== 4) {
                skipped++;
                continue;
            }

            var left   = gb[0];
            var top    = gb[1];
            var right  = gb[2];
            var bottom = gb[3];

            var width  = right - left;
            var height = top   - bottom;

            var maxDim = Math.max(Math.abs(width), Math.abs(height));
            if (maxDim <= 0) {
                skipped++;
                continue;
            }

            // Name
            var name;
            if (node.name && node.name !== "") {
                name = node.name;
            } else {
                if (node.typename === "GroupItem") {
                    name = "Group_" + idx;
                } else if (node.typename === "PathItem") {
                    name = "Path_" + idx;
                } else {
                    name = "Object_" + idx;
                }
            }
            var safeName = name.replace(/[^\w\-]/g, "_");

            // coords relative to artboard (center)
            var centerX = left + width / 2;
            var centerY = top  - height / 2;

            var xRel = centerX - abLeft;
            var yRel = abTop   - centerY;

            var rotation = 0;
            try { rotation = node.rotation || 0; } catch (eRot) {}

            // z-order: index in exportItems list (bottom → top)
            var zorder = idx;

            // ----- COMPUTE SIGNATURE -----
            var sigItems;
            if (node.typename === "GroupItem") {
                // Use its children as geometry source
                sigItems = node.pageItems;
            } else {
                // Single PathItem
                sigItems = [node];
            }
            var signature = computeSignatureForItems(sigItems);

            // ----- HIDE EVERYTHING EXCEPT THIS LAYER + NODE -----

            // save & isolate layer visibility (only this layer visible)
            for (var li = 0; li < doc.layers.length; li++) {
                var lay = doc.layers[li];
                prevLayerVisible[li] = lay.visible;
                lay.visible = (lay == layer);
            }

            // save & hide all pageItems on this layer
            var allItems = layer.pageItems;
            for (var pi2 = 0; pi2 < allItems.length; pi2++) {
                prevHidden[pi2] = allItems[pi2].hidden;
                try {
                    allItems[pi2].hidden = true;
                } catch (eh) {}
            }

            // ensure current node visible
            try { node.hidden = false; } catch (eh2) {}

            // -------------------------
            // 6) EXPORT THUMBNAIL (TEMP ARTBOARD)
            // -------------------------
            var tmpAB = doc.artboards.add(gb);
            tmpABIndex = doc.artboards.length - 1;
            doc.artboards.setActiveArtboardIndex(tmpABIndex);

            var scalePercent = (thumbSize / maxDim) * 100;

            var opts = new ExportOptionsPNG24();
            opts.artBoardClipping = true;
            opts.horizontalScale  = scalePercent;
            opts.verticalScale    = scalePercent;
            opts.transparency     = true;

            var thumbFile = new File(thumbFolder.fsName + "/" + safeName + ".png");
            doc.exportFile(thumbFile, ExportType.PNG24, opts);

            // -------------------------
            // 7) ADD JSON ENTRY
            // -------------------------
            jsonLines.push(
                '    { "name": "' + escJSON(name) + '", ' +
                '"x": ' + xRel.toFixed(2) + ', ' +
                '"y": ' + yRel.toFixed(2) + ', ' +
                '"width": ' + width.toFixed(2) + ', ' +
                '"height": ' + height.toFixed(2) + ', ' +
                '"rotation": ' + rotation.toFixed(2) + ', ' +
                '"zorder": ' + zorder + ', ' +
                '"signature": "' + escJSON(signature) + '", ' +
                '"thumbnail": "thumbnails/' + escJSON(safeName) + '.png" }'
            );

            exported++;

        } catch (e) {
            skipped++;
            $.writeln("Skipped item " + idx + " (" + (node.name || node.typename) + "): " + e);
        } finally {
            // restore pageItems hidden state
            try {
                var allItems2 = layer.pageItems;
                for (var ri = 0; ri < allItems2.length && ri < prevHidden.length; ri++) {
                    try {
                        allItems2[ri].hidden = prevHidden[ri];
                    } catch (eh3) {}
                }
            } catch (eRestorePI) {}

            // restore layer visibility
            try {
                for (var li2 = 0; li2 < doc.layers.length && li2 < prevLayerVisible.length; li2++) {
                    doc.layers[li2].visible = prevLayerVisible[li2];
                }
            } catch (eRestoreL) {}

            // remove temp artboard and restore active artboard
            try {
                if (tmpABIndex !== null && tmpABIndex < doc.artboards.length) {
                    doc.artboards.remove(tmpABIndex);
                }
            } catch (eAB) {}

            try {
                doc.artboards.setActiveArtboardIndex(activeAbIndex);
            } catch (eSetAB) {}
        }
    }

    // -------------------------
    // 8) WRITE JSON FILE
    // -------------------------
    jsonFile.writeln("{");
    jsonFile.writeln('  "artboard": "' + escJSON(abName) + '",');
    jsonFile.writeln('  "layer": "' + escJSON(layer.name) + '",');
    jsonFile.writeln('  "objects": [');

    for (var j = 0; j < jsonLines.length; j++) {
        var suffix = (j < jsonLines.length - 1) ? "," : "";
        jsonFile.writeln(jsonLines[j] + suffix);
    }

    jsonFile.writeln("  ]");
    jsonFile.writeln("}");
    jsonFile.close();

    alert(
        "Export complete.\n" +
        "Artboard: " + abName + "\n" +
        "Layer: " + layer.name + "\n" +
        "Thumbnail size: " + thumbSize + " px\n" +
        "Exported objects: " + exported + "\n" +
        "Skipped (locked/empty/error): " + skipped
    );

})();