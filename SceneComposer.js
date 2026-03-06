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

    // ============================================================
    // Helpers
    // ============================================================
    function escJSON(str) {
        if (!str) str = "";
        return str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    }

    function simpleHash(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = (h * 31 + str.charCodeAt(i)) & 0x7FFFFFFF;
        }
        return h.toString(16);
    }

    function sanitizeFileName(str) {
        if (!str) str = "export";
        return str.replace(/[\\\/:\*\?"<>\|]/g, "_");
    }

    function getDocumentBaseName(documentObj) {
        var n = documentObj.name || "Untitled";
        return n.replace(/\.[^\.]+$/, "");
    }

    function getSafeLayerName(layerObj) {
        if (!layerObj) return "AllLayers";
        var n = layerObj.name || "UnnamedLayer";
        return sanitizeFileName(n);
    }

    function getSafeArtboardName(abName) {
        return sanitizeFileName(abName || "Artboard");
    }

    function buildDefaultExportName(aiName, artboardName, layerName, scopeMode) {
        if (scopeMode === "Whole Artboard") {
            return sanitizeFileName(aiName + "-" + artboardName + "-AllLayers");
        }
        return sanitizeFileName(aiName + "-" + artboardName + "-" + layerName);
    }

    function intersectsArtboard(itemBounds, artboardRect) {
        // Both are [left, top, right, bottom]
        var il = itemBounds[0];
        var it = itemBounds[1];
        var ir = itemBounds[2];
        var ib = itemBounds[3];

        var al = artboardRect[0];
        var at = artboardRect[1];
        var ar = artboardRect[2];
        var ab = artboardRect[3];

        if (ir < al) return false;
        if (il > ar) return false;
        if (it < ab) return false;
        if (ib > at) return false;

        return true;
    }

    // ============================================================
    // Current document / artboards / layers
    // ============================================================
    var currentAbIndex = doc.artboards.getActiveArtboardIndex();
    var docBaseName = getDocumentBaseName(doc);
    var safeDocBaseName = sanitizeFileName(docBaseName);

    var artboardNames = [];
    for (var a = 0; a < doc.artboards.length; a++) {
        var abn = doc.artboards[a].name;
        if (!abn || abn === "") abn = "Artboard_" + (a + 1);
        artboardNames.push(abn);
    }

    var layerNames = [];
    for (var i = 0; i < doc.layers.length; i++) {
        var ln = doc.layers[i].name;
        if (!ln || ln === "") ln = "Layer_" + (i + 1);
        layerNames.push(ln);
    }

    // ============================================================
    // UI
    // ============================================================
    var dlg = new Window("dialog", "Export JSON + Thumbnails");
    dlg.orientation = "column";
    dlg.alignChildren = "fill";

    dlg.add("statictext", undefined, "Export Scope:");
    var ddScope = dlg.add("dropdownlist", undefined, ["Selected Layer", "Whole Artboard"]);
    ddScope.selection = 0;

    dlg.add("statictext", undefined, "Layer:");
    var ddLayer = dlg.add("dropdownlist", undefined, layerNames);
    ddLayer.selection = 0;

    dlg.add("statictext", undefined, "Artboard:");
    var ddArtboard = dlg.add("dropdownlist", undefined, artboardNames);
    ddArtboard.selection = currentAbIndex;

    dlg.add("statictext", undefined, "Thumbnail size (pixels):");
    var ddSize = dlg.add("dropdownlist", undefined, ["64", "128", "256"]);
    ddSize.selection = 1;

    dlg.add("statictext", undefined, "Custom Export Name:");
    var txtSceneName = dlg.add("edittext", undefined, "");
    txtSceneName.characters = 40;

    function refreshSceneNameField() {
        var selectedAbName = artboardNames[ddArtboard.selection.index];
        var selectedLayerName = layerNames[ddLayer.selection.index];
        var scopeMode = ddScope.selection.text;

        txtSceneName.text = buildDefaultExportName(
            docBaseName,
            getSafeArtboardName(selectedAbName),
            sanitizeFileName(selectedLayerName),
            scopeMode
        );
    }

    function refreshUIState() {
        var scopeMode = ddScope.selection.text;
        ddLayer.enabled = (scopeMode === "Selected Layer");
        refreshSceneNameField();
    }

    ddScope.onChange = refreshUIState;
    ddArtboard.onChange = refreshSceneNameField;
    ddLayer.onChange = refreshSceneNameField;

    refreshUIState();

    var gBtns = dlg.add("group");
    gBtns.alignment = "right";
    gBtns.add("button", undefined, "OK", { name: "ok" });
    gBtns.add("button", undefined, "Cancel", { name: "cancel" });

    if (dlg.show() !== 1) return;

    var scopeMode = ddScope.selection.text;
    var selectedLayer = doc.layers[ddLayer.selection.index];
    var thumbSize = parseInt(ddSize.selection.text, 10);
    var selectedAbIndex = ddArtboard.selection.index;

    var sceneName = txtSceneName.text && txtSceneName.text !== ""
        ? sanitizeFileName(txtSceneName.text)
        : buildDefaultExportName(
            docBaseName,
            getSafeArtboardName(artboardNames[selectedAbIndex]),
            getSafeLayerName(selectedLayer),
            scopeMode
        );

    var ab = doc.artboards[selectedAbIndex];
    var abRect = ab.artboardRect;
    var abLeft = abRect[0];
    var abTop = abRect[1];
    var abName = ab.name || ("Artboard_" + (selectedAbIndex + 1));

    if (scopeMode === "Selected Layer" && !selectedLayer) {
        alert("Invalid layer.");
        return;
    }

    // ============================================================
    // Output structure
    // Parent/
    //   IllustratorFileName/
    //     SceneName/
    //       SceneName.json
    //       thumbnails/
    // ============================================================
    var parentFolder = Folder.selectDialog("Select parent export folder");
    if (!parentFolder) return;

    var docFolder = new Folder(parentFolder.fsName + "/" + safeDocBaseName);
    if (!docFolder.exists) docFolder.create();

    var sceneFolder = new Folder(docFolder.fsName + "/" + sceneName);
    if (!sceneFolder.exists) sceneFolder.create();

    var thumbFolder = new Folder(sceneFolder.fsName + "/thumbnails");
    if (!thumbFolder.exists) thumbFolder.create();

    var jsonFile = new File(sceneFolder.fsName + "/" + sceneName + ".json");
    if (!jsonFile.open("w")) {
        alert("Could not create JSON file.");
        return;
    }

    // ============================================================
    // Strict geometry signature
    // ============================================================
    function computeSignatureForItems(items) {
        var parts = [];
        var baseX = null;
        var baseY = null;

        try {
            for (var i = 0; i < items.length && baseX === null; i++) {
                var it0 = items[i];
                if (it0.typename === "PathItem" && it0.pathPoints.length > 0) {
                    var pt0 = it0.pathPoints[0].anchor;
                    baseX = pt0[0];
                    baseY = pt0[1];
                }
            }

            if (baseX === null || baseY === null) {
                var fallback = [];
                for (var j = 0; j < items.length; j++) {
                    fallback.push(items[j].typename);
                }
                return simpleHash(fallback.join("|"));
            }

            for (var k = 0; k < items.length; k++) {
                var it = items[k];

                if (it.typename === "PathItem") {
                    var p = it;
                    parts.push("P");
                    parts.push(p.closed ? "1" : "0");
                    parts.push("#" + p.pathPoints.length);

                    for (var m = 0; m < p.pathPoints.length; m++) {
                        var a = p.pathPoints[m].anchor;
                        var nx = a[0] - baseX;
                        var ny = a[1] - baseY;
                        parts.push(nx.toFixed(2) + "," + ny.toFixed(2));
                    }
                }
                else if (it.typename === "PlacedItem") {
                    parts.push("I");
                    try {
                        if (it.file && it.file.name) parts.push(it.file.name);
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
        } catch (e) {}

        return simpleHash(parts.join("|"));
    }

    // ============================================================
    // Collect path points recursively
    // ============================================================
    function collectPathPoints(item, outPoints) {
        if (!item) return;

        try {
            if (item.typename === "PathItem") {
                for (var i = 0; i < item.pathPoints.length; i++) {
                    var a = item.pathPoints[i].anchor;
                    outPoints.push([a[0], a[1]]);
                }
            }
            else if (item.typename === "GroupItem" || item.typename === "CompoundPathItem") {
                var kids = item.pageItems;
                for (var j = 0; j < kids.length; j++) {
                    collectPathPoints(kids[j], outPoints);
                }
            }
        } catch (e) {}
    }

    function collectPointsFromItems(items) {
        var pts = [];
        for (var i = 0; i < items.length; i++) {
            collectPathPoints(items[i], pts);
        }
        return pts;
    }

    // ============================================================
    // Rotation-invariant + flip-invariant shape signature
    // ============================================================
    function computeShapeSpectrumSignature(items) {
        var pts = collectPointsFromItems(items);

        if (!pts || pts.length < 3) {
            var fb = [];
            for (var i = 0; i < items.length; i++) fb.push(items[i].typename);
            return simpleHash("fallback|" + fb.join("|"));
        }

        var minX =  1e20, minY =  1e20;
        var maxX = -1e20, maxY = -1e20;

        for (var i = 0; i < pts.length; i++) {
            var x = pts[i][0];
            var y = pts[i][1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }

        var cx = (minX + maxX) * 0.5;
        var cy = (minY + maxY) * 0.5;

        var bins = 36;
        var spectrum = [];
        for (var b = 0; b < bins; b++) spectrum[b] = 0;

        var maxRadius = 0;
        var polar = [];

        for (var p = 0; p < pts.length; p++) {
            var dx = pts[p][0] - cx;
            var dy = pts[p][1] - cy;

            var r = Math.sqrt(dx * dx + dy * dy);
            if (r > maxRadius) maxRadius = r;

            var angle = Math.atan2(dy, dx);
            polar.push({ angle: angle, radius: r });
        }

        if (maxRadius < 0.0001) {
            return simpleHash("degenerate");
        }

        for (var q = 0; q < polar.length; q++) {
            var pr = polar[q];
            var normRadius = pr.radius / maxRadius;

            var ang = pr.angle + Math.PI;
            var bin = Math.floor((ang / (2 * Math.PI)) * bins);
            if (bin < 0) bin = 0;
            if (bin >= bins) bin = bins - 1;

            if (normRadius > spectrum[bin]) {
                spectrum[bin] = normRadius;
            }
        }

        function spectrumToString(arr) {
            var parts = [];
            for (var i = 0; i < arr.length; i++) {
                parts.push(arr[i].toFixed(4));
            }
            return parts.join("|");
        }

        function rotateArray(arr, shift) {
            var out = [];
            var n = arr.length;
            for (var i = 0; i < n; i++) {
                out.push(arr[(i + shift) % n]);
            }
            return out;
        }

        function reverseArray(arr) {
            var out = [];
            for (var i = arr.length - 1; i >= 0; i--) {
                out.push(arr[i]);
            }
            return out;
        }

        function getCanonicalSpectrumString(arr) {
            var best = null;
            var n = arr.length;

            // all rotations
            for (var s = 0; s < n; s++) {
                var rotated = rotateArray(arr, s);
                var str = spectrumToString(rotated);
                if (best === null || str < best) best = str;
            }

            // all rotations of reversed array (flip-invariant too)
            var reversed = reverseArray(arr);
            for (var r = 0; r < n; r++) {
                var rotatedRev = rotateArray(reversed, r);
                var revStr = spectrumToString(rotatedRev);
                if (best === null || revStr < best) best = revStr;
            }

            return best;
        }

        var canonical = getCanonicalSpectrumString(spectrum);
        return simpleHash(canonical);
    }

    // ============================================================
    // Build export list
    // ============================================================
    var exportItems = []; // { node, sourceLayerName, zorder }

    if (scopeMode === "Selected Layer") {
        for (var pi = 0; pi < selectedLayer.pageItems.length; pi++) {
            var it = selectedLayer.pageItems[pi];
            if ((it.typename === "GroupItem" || it.typename === "PathItem") &&
                intersectsArtboard(it.geometricBounds, abRect)) {
                exportItems.push({
                    node: it,
                    sourceLayerName: selectedLayer.name,
                    zorder: exportItems.length
                });
            }
        }
    } else {
        for (var li = 0; li < doc.layers.length; li++) {
            var layerObj = doc.layers[li];
            for (var pi2 = 0; pi2 < layerObj.pageItems.length; pi2++) {
                var it2 = layerObj.pageItems[pi2];
                if ((it2.typename === "GroupItem" || it2.typename === "PathItem") &&
                    intersectsArtboard(it2.geometricBounds, abRect)) {
                    exportItems.push({
                        node: it2,
                        sourceLayerName: layerObj.name,
                        zorder: exportItems.length
                    });
                }
            }
        }
    }

    if (exportItems.length === 0) {
        jsonFile.close();
        alert("No top-level Groups or Paths found for the selected scope.");
        return;
    }

    // ============================================================
    // Main export loop
    // ============================================================
    var jsonLines = [];
    var exported = 0;
    var skipped = 0;
    var previousActiveAbIndex = doc.artboards.getActiveArtboardIndex();

    for (var idx = 0; idx < exportItems.length; idx++) {

        var record = exportItems[idx];
        var node = record.node;

        if (!node || node.locked || node.hidden) {
            skipped++;
            continue;
        }

        if (node.typename === "GroupItem" && node.pageItems.length === 0) {
            skipped++;
            continue;
        }

        var tmpABIndex = null;
        var prevLayerVisible = [];
        var allDocHidden = [];

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
            var height = top - bottom;

            var maxDim = Math.max(Math.abs(width), Math.abs(height));
            if (maxDim <= 0) {
                skipped++;
                continue;
            }

            var name;
            if (node.name && node.name !== "") {
                name = node.name;
            } else {
                name = (node.typename === "GroupItem") ? ("Group_" + idx) : ("Path_" + idx);
            }

            var safeName = name.replace(/[^\w\-]/g, "_");

            var centerX = left + width / 2;
            var centerY = top - height / 2;

            var xRel = centerX - abLeft;
            var yRel = abTop - centerY;

            var rotation = 0;
            try { rotation = node.rotation || 0; } catch (eRot) {}

            var sigItems = (node.typename === "GroupItem") ? node.pageItems : [node];
            var signature = computeSignatureForItems(sigItems);
            var shapeSignature = computeShapeSpectrumSignature(sigItems);

            // Hide all doc items
            for (var li2 = 0; li2 < doc.layers.length; li2++) {
                var lay = doc.layers[li2];
                prevLayerVisible[li2] = lay.visible;
                lay.visible = true;
            }

            for (var l = 0; l < doc.layers.length; l++) {
                var lay2 = doc.layers[l];
                for (var p = 0; p < lay2.pageItems.length; p++) {
                    var itemRef = lay2.pageItems[p];
                    allDocHidden.push(itemRef.hidden);
                    try { itemRef.hidden = true; } catch (eh) {}
                }
            }

            try { node.hidden = false; } catch (eh2) {}

            doc.artboards.setActiveArtboardIndex(selectedAbIndex);

            doc.artboards.add(gb);
            tmpABIndex = doc.artboards.length - 1;
            doc.artboards.setActiveArtboardIndex(tmpABIndex);

            var scalePercent = (thumbSize / maxDim) * 100;

            var opts = new ExportOptionsPNG24();
            opts.artBoardClipping = true;
            opts.horizontalScale = scalePercent;
            opts.verticalScale = scalePercent;
            opts.transparency = true;

            var thumbFile = new File(thumbFolder.fsName + "/" + safeName + ".png");
            doc.exportFile(thumbFile, ExportType.PNG24, opts);

            jsonLines.push(
                '    { "name": "' + escJSON(name) + '", ' +
                '"type": "' + escJSON(node.typename) + '", ' +
                '"sourceLayer": "' + escJSON(record.sourceLayerName) + '", ' +
                '"x": ' + xRel.toFixed(2) + ', ' +
                '"y": ' + yRel.toFixed(2) + ', ' +
                '"width": ' + width.toFixed(2) + ', ' +
                '"height": ' + height.toFixed(2) + ', ' +
                '"rotation": ' + rotation.toFixed(2) + ', ' +
                '"zorder": ' + record.zorder + ', ' +
                '"signature": "' + escJSON(signature) + '", ' +
                '"shapeSignature": "' + escJSON(shapeSignature) + '", ' +
                '"thumbnail": "thumbnails/' + escJSON(safeName) + '.png" }'
            );

            exported++;

        } catch (e) {
            skipped++;
            $.writeln("Skipped item " + idx + " (" + (node.name || node.typename) + "): " + e);

        } finally {
            try {
                var restoreIndex = 0;
                for (var l2 = 0; l2 < doc.layers.length; l2++) {
                    var layRestore = doc.layers[l2];
                    for (var p2 = 0; p2 < layRestore.pageItems.length; p2++) {
                        try {
                            layRestore.pageItems[p2].hidden = allDocHidden[restoreIndex];
                        } catch (eh3) {}
                        restoreIndex++;
                    }
                }
            } catch (eRestorePI) {}

            try {
                for (var lv = 0; lv < doc.layers.length && lv < prevLayerVisible.length; lv++) {
                    doc.layers[lv].visible = prevLayerVisible[lv];
                }
            } catch (eRestoreL) {}

            try {
                if (tmpABIndex !== null && tmpABIndex < doc.artboards.length) {
                    doc.artboards.remove(tmpABIndex);
                }
            } catch (eAB) {}

            try {
                doc.artboards.setActiveArtboardIndex(previousActiveAbIndex);
            } catch (eSetAB) {}
        }
    }

    // ============================================================
    // Write JSON
    // ============================================================
    jsonFile.writeln("{");
    jsonFile.writeln('  "sceneName": "' + escJSON(sceneName) + '",');
    jsonFile.writeln('  "documentName": "' + escJSON(docBaseName) + '",');
    jsonFile.writeln('  "exportScope": "' + escJSON(scopeMode) + '",');
    jsonFile.writeln('  "artboard": "' + escJSON(abName) + '",');
    jsonFile.writeln('  "layer": "' + escJSON(scopeMode === "Selected Layer" ? selectedLayer.name : "ALL_LAYERS") + '",');
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
        "Document Folder: " + safeDocBaseName + "\n" +
        "Scene Folder: " + sceneName + "\n" +
        "JSON File: " + sceneName + ".json\n" +
        "Scope: " + scopeMode + "\n" +
        "Artboard: " + abName + "\n" +
        "Layer: " + (scopeMode === "Selected Layer" ? selectedLayer.name : "ALL_LAYERS") + "\n" +
        "Thumbnail size: " + thumbSize + " px\n" +
        "Exported objects: " + exported + "\n" +
        "Skipped: " + skipped
    );

})();