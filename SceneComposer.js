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

    function degToRad(deg) {
        return deg * Math.PI / 180.0;
    }

    // Rotate point around center by angleRad
    function rotatePoint(px, py, cx, cy, angleRad) {
        var dx = px - cx;
        var dy = py - cy;

        var cosA = Math.cos(angleRad);
        var sinA = Math.sin(angleRad);

        var rx = dx * cosA - dy * sinA;
        var ry = dx * sinA + dy * cosA;

        return [cx + rx, cy + ry];
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
    // Rotation-normalized points
    // Removes rotation from the geometry before signature analysis
    // ============================================================
    function getRotationNormalizedPoints(items, rotationDeg) {
        var pts = collectPointsFromItems(items);
        if (!pts || pts.length === 0) return [];

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

        var angleRad = degToRad(-rotationDeg);

        var out = [];
        for (var p = 0; p < pts.length; p++) {
            var rp = rotatePoint(pts[p][0], pts[p][1], cx, cy, angleRad);
            out.push(rp);
        }

        return out;
    }

    // ============================================================
    // Strict geometry signature
    // Uses unrotated geometry
    // ============================================================
    function computeRotationNormalizedSignature(items, rotationDeg) {
        var pts = getRotationNormalizedPoints(items, rotationDeg);

        if (!pts || pts.length < 1) {
            var fallback = [];
            for (var j = 0; j < items.length; j++) {
                fallback.push(items[j].typename);
            }
            return simpleHash(fallback.join("|"));
        }

        var minX =  1e20, minY =  1e20;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i][0] < minX) minX = pts[i][0];
            if (pts[i][1] < minY) minY = pts[i][1];
        }

        var normalized = [];
        for (var k = 0; k < pts.length; k++) {
            normalized.push([
                pts[k][0] - minX,
                pts[k][1] - minY
            ]);
        }

        var parts = [];
        parts.push("P");
        parts.push("#" + normalized.length);

        for (var n = 0; n < normalized.length; n++) {
            parts.push(
                normalized[n][0].toFixed(3) + "," +
                normalized[n][1].toFixed(3)
            );
        }

        return simpleHash(parts.join("|"));
    }

    // ============================================================
    // Rotation-normalized + scale-normalized + flip-invariant
    // More tolerant family signature
    // ============================================================
    function computeRotationNormalizedShapeSignature(items, rotationDeg) {
        var pts = getRotationNormalizedPoints(items, rotationDeg);

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

        var width = maxX - minX;
        var height = maxY - minY;

        if (Math.abs(width) < 0.0001 || Math.abs(height) < 0.0001) {
            return simpleHash("degenerate");
        }

        var canonicalA = [];
        var canonicalB = [];

        for (var p = 0; p < pts.length; p++) {
            var nx = (pts[p][0] - minX) / width;
            var ny = (pts[p][1] - minY) / height;

            canonicalA.push(nx.toFixed(4) + "," + ny.toFixed(4));
            canonicalB.push((1.0 - nx).toFixed(4) + "," + ny.toFixed(4));
        }

        canonicalA.sort();
        canonicalB.sort();

        var strA = canonicalA.join("|");
        var strB = canonicalB.join("|");

        return simpleHash(strA < strB ? strA : strB);
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
            var signature = computeRotationNormalizedSignature(sigItems, rotation);
            var shapeSignature = computeRotationNormalizedShapeSignature(sigItems, rotation);

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