#target illustrator

(function () {

    if (app.documents.length === 0) { alert("No document open."); return; }
    var doc = app.activeDocument;

    if (doc.layers.length === 0) { alert("The document has no layers."); return; }

    // 1) Layer + thumbnail size selection
    var layerNames = [];
    for (var i = 0; i < doc.layers.length; i++) {
        var ln = doc.layers[i].name;
        if (!ln || ln === "") ln = "Layer " + (i + 1);
        layerNames.push(ln);
    }

    var dlg = new Window("dialog", "Export JSON + Thumbnails");
    dlg.orientation = "column";
    dlg.alignChildren = "fill";

    dlg.add("statictext", undefined, "Export all top-level groups from layer:");
    var ddLayer = dlg.add("dropdownlist", undefined, layerNames);
    ddLayer.selection = 0;

    dlg.add("statictext", undefined, "Thumbnail size (pixels):");
    var ddSize = dlg.add("dropdownlist", undefined, ["64", "128", "256"]);
    ddSize.selection = 1;

    var gBtns = dlg.add("group");
    gBtns.alignment = "right";
    gBtns.add("button", undefined, "OK", {name:"ok"});
    gBtns.add("button", undefined, "Cancel", {name:"cancel"});

    if (dlg.show() !== 1) return;

    var layer     = doc.layers[ddLayer.selection.index];
    var thumbSize = parseInt(ddSize.selection.text, 10);

    if (!layer || layer.groupItems.length === 0) {
        alert("Selected layer has no top-level groups.");
        return;
    }

    // 2) Active artboard for relative coords
    var activeAbIndex = doc.artboards.getActiveArtboardIndex();
    var ab      = doc.artboards[activeAbIndex];
    var abRect  = ab.artboardRect; // [left, top, right, bottom]
    var abLeft  = abRect[0];
    var abTop   = abRect[1];

    // 3) Output folder + JSON
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
        return str.replace(/\\/g,"\\\\").replace(/"/g,"\\\"");
    }

    var jsonLines    = [];
    var exported     = 0;
    var skipped      = 0;

    // 4) Process each top-level group
    for (var i = 0; i < layer.groupItems.length; i++) {

        var g = layer.groupItems[i];

        if (!g || g.locked || g.hidden || g.pageItems.length === 0) {
            skipped++;
            continue;
        }

        var tmpABIndex = null;
        var prevLayerVisible = [];
        var prevHidden = [];

        try {
            var gb = g.geometricBounds;
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

            var name     = g.name && g.name !== "" ? g.name : ("Group_" + i);
            var safeName = name.replace(/[^\w\-]/g, "_");

            // coords relative to artboard
            var centerX = left + width  / 2;
            var centerY = top  - height / 2;

            var xRel = centerX - abLeft;
            var yRel = abTop   - centerY;

            var rotation = 0;
            try { rotation = g.rotation || 0; } catch(eRot){}

            // z-order (bottom = 0, top = last)
            var zorder = i;

            // ---- hide everything except this group ----
            // save and isolate layer visibility
            for (var li = 0; li < doc.layers.length; li++) {
                var lay = doc.layers[li];
                prevLayerVisible[li] = lay.visible;
                lay.visible = (lay == layer);
            }

            // save and hide all pageItems on this layer
            var items = layer.pageItems;
            for (var pi = 0; pi < items.length; pi++) {
                prevHidden[pi] = items[pi].hidden;
                try { items[pi].hidden = true; } catch(eh) {}
            }

            // ensure current group visible
            try { g.hidden = false; } catch(eh2) {}

            // ---- temp artboard around this group ----
            var tmpAB = doc.artboards.add(gb);
            tmpABIndex = doc.artboards.length - 1;
            doc.artboards.setActiveArtboardIndex(tmpABIndex);

            var scalePercent = (thumbSize / maxDim) * 100;

            var opts = new ExportOptionsPNG24();
            opts.artBoardClipping  = true;
            opts.horizontalScale   = scalePercent;
            opts.verticalScale     = scalePercent;
            opts.transparency      = true;

            var thumbFile = new File(thumbFolder.fsName + "/" + safeName + ".png");
            doc.exportFile(thumbFile, ExportType.PNG24, opts);

            // ---- JSON entry ----
            jsonLines.push(
                '    { "name": "' + escJSON(name) + '", ' +
                '"x": ' + xRel.toFixed(2) + ', ' +
                '"y": ' + yRel.toFixed(2) + ', ' +
                '"width": ' + width.toFixed(2) + ', ' +
                '"height": ' + height.toFixed(2) + ', ' +
                '"rotation": ' + rotation.toFixed(2) + ', ' +
                '"zorder": ' + zorder + ', ' +
                '"thumbnail": "thumbnails/' + escJSON(safeName) + '.png" }'
            );

            exported++;

        } catch (e) {
            skipped++;
            $.writeln("Skipped group " + i + " (" + (g.name || "unnamed") + "): " + e);
        } finally {
            // restore pageItems hidden state
            try {
                var items2 = layer.pageItems;
                for (var pi2 = 0; pi2 < items2.length && pi2 < prevHidden.length; pi2++) {
                    try { items2[pi2].hidden = prevHidden[pi2]; } catch(eh3) {}
                }
            } catch (eRestorePI) {}

            // restore layer visibility
            try {
                for (var li2 = 0; li2 < doc.layers.length && li2 < prevLayerVisible.length; li2++) {
                    doc.layers[li2].visible = prevLayerVisible[li2];
                }
            } catch (eRestoreL) {}

            // remove temp artboard and restore active
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

    // 5) Write JSON file
    jsonFile.writeln("{");
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
        "Layer: " + layer.name + "\n" +
        "Thumbnail size: " + thumbSize + " px\n" +
        "Exported groups: " + exported + "\n" +
        "Skipped (locked/empty/error): " + skipped
    );

})();
