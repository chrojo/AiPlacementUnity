using System;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

#region Data Models

[Serializable]
public class IllustratorObjectData
{
    public string name;
    public float x;
    public float y;
    public float width;
    public float height;
    public float rotation;
    public string thumbnail;
    public int zorder;
}

[Serializable]
public class IllustratorExportData
{
    public string layer;
    public IllustratorObjectData[] objects;
}

public class IllustratorObjectView
{
    public IllustratorObjectData data;
    public string gameObjectName;
    public bool useCustomName = false;

    public Texture2D thumbnail;
    public bool create = true;

    public bool selected = false;   // visual selection for the whole card

    public GameObject prefab;       // Either prefab...
    public Sprite sprite;           // ...or sprite (mutually exclusive)
}

#endregion

public class IllustratorPlacementWindow : EditorWindow
{
    private string jsonPath = "";

    private IllustratorExportData exportData;
    private IllustratorObjectView[] views;

    private Transform parentTransform;
    private GameObject globalPrefab;

    // Default for 153.6 PPU → 1 / 153.6 ≈ 0.0065104167
    private float positionScale = 0.0065104167f;
    private bool flipY = true;
    private bool useLocalPosition = false;

    private Vector2 galleryScroll;

    [MenuItem("Tools/Illustrator Placement Tool")]
    public static void ShowWindow()
    {
        var win = GetWindow<IllustratorPlacementWindow>("Illustrator Placement");
        win.minSize = new Vector2(700, 400);
    }

    private void OnGUI()
    {
        EditorGUILayout.BeginHorizontal();

        // LEFT: GALLERY
        EditorGUILayout.BeginVertical(GUILayout.ExpandWidth(true));
        DrawGalleryPanel();
        EditorGUILayout.EndVertical();

        // RIGHT: IMPORT + ACTIONS
        EditorGUILayout.BeginVertical(GUILayout.Width(280));
        DrawRightPanel();
        EditorGUILayout.EndVertical();

        EditorGUILayout.EndHorizontal();
    }

    #region Gallery

    private void DrawGalleryPanel()
    {
        if (exportData != null)
            EditorGUILayout.LabelField("Layer: " + exportData.layer, EditorStyles.miniBoldLabel);

        galleryScroll = EditorGUILayout.BeginScrollView(galleryScroll);

        if (views == null || views.Length == 0)
        {
            EditorGUILayout.HelpBox("Load a JSON file from the right panel.", MessageType.Info);
            EditorGUILayout.EndScrollView();
            return;
        }

        int columns = 5;
        float rightPanelWidth = 280f;
        float totalWidth = position.width - rightPanelWidth - 40f;
        if (totalWidth < 200f) totalWidth = position.width - 40f;
        float cardWidth = totalWidth / columns;
        if (cardWidth < 120f) cardWidth = 120f;

        for (int i = 0; i < views.Length; i += columns)
        {
            EditorGUILayout.BeginHorizontal();
            for (int c = 0; c < columns; c++)
            {
                int index = i + c;
                if (index >= views.Length)
                    break;

                DrawObjectCardCompact(views[index], cardWidth);
            }
            EditorGUILayout.EndHorizontal();
        }

        EditorGUILayout.EndScrollView();
    }

    /// <summary>
    /// Card that:
    /// - Is selectable as a whole (like a folder/file).
    /// - Shows thumbnail, names, prefab & sprite fields, and create toggle.
    /// - Prefab & Sprite are mutually exclusive.
    /// - Supports drag & drop: prefab/sprite dropped on a card is applied to
    ///   all selected cards (or just that card if none selected).
    /// </summary>
    private void DrawObjectCardCompact(IllustratorObjectView v, float cardWidth)
    {
        // Tint the box if selected
        Color oldColor = GUI.color;
        if (v.selected)
            GUI.color = new Color(0.24f, 0.24f, 0.24f);  // light gray

        GUILayout.BeginVertical("box", GUILayout.Width(cardWidth));

        // Reset color so inner controls look normal
        GUI.color = oldColor;

        // Create toggle
        v.create = GUILayout.Toggle(v.create, "Create", GUILayout.Height(16));

        // Thumbnail
        GUILayout.BeginHorizontal();
        GUILayout.FlexibleSpace();
        GUILayout.Label(v.thumbnail != null ? v.thumbnail : Texture2D.grayTexture,
            GUILayout.Width(40), GUILayout.Height(40));
        GUILayout.FlexibleSpace();
        GUILayout.EndHorizontal();

        // Prefab name (first line)
        string prefabName = v.prefab ? v.prefab.name : "No prefab";
        var prefabNameStyle = new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize = 9,
            alignment = TextAnchor.MiddleCenter,
            normal = { textColor = v.prefab ? Color.white : new Color(1, 1, 1, 0.35f) }
        };
        GUILayout.Label(prefabName, prefabNameStyle);

        // Illustrator name (second line)
        string illustratorLabel = string.IsNullOrEmpty(v.data.name) ? "Object" : v.data.name;
        var illustratorStyle = new GUIStyle(EditorStyles.miniLabel)
        {
            fontSize = 8,
            alignment = TextAnchor.MiddleCenter
        };
        GUILayout.Label(illustratorLabel, illustratorStyle);

        // Prefab field (with label)
        EditorGUILayout.LabelField("Prefab", EditorStyles.miniLabel);
        EditorGUI.BeginChangeCheck();
        GameObject newPrefab = (GameObject)EditorGUILayout.ObjectField(
            GUIContent.none,
            v.prefab,
            typeof(GameObject),
            false,
            GUILayout.Height(14));
        if (EditorGUI.EndChangeCheck())
        {
            v.prefab = newPrefab;
            if (newPrefab != null)
            {
                // Prefab chosen → clear sprite (mutual exclusive)
                v.sprite = null;
            }
        }

        // Sprite field (with label)
        EditorGUILayout.LabelField("Sprite", EditorStyles.miniLabel);
        EditorGUI.BeginChangeCheck();
        Sprite newSprite = (Sprite)EditorGUILayout.ObjectField(
            GUIContent.none,
            v.sprite,
            typeof(Sprite),
            false,
            GUILayout.Height(14));
        if (EditorGUI.EndChangeCheck())
        {
            v.sprite = newSprite;
            if (newSprite != null)
            {
                // Sprite chosen → clear prefab (mutual exclusive)
                v.prefab = null;
            }
        }

        GUILayout.EndVertical();

        // Get the rect Unity just used for this vertical card
        Rect cardRect = GUILayoutUtility.GetLastRect();

        // ---- Change cursor when hovering ----
        if (cardRect.Contains(Event.current.mousePosition))
        {
            // Options:
            // Link        = pointer hand
            // ArrowPlus   = arrow with plus sign
            // SlideArrow  = arrows left-right
            // MoveArrow   = move icon
            // You can customize later
            EditorGUIUtility.AddCursorRect(cardRect, MouseCursor.Link);
        }

        // Click on the whole card toggles selection
        Event e = Event.current;
        if (e.type == EventType.MouseDown && e.button == 0 && cardRect.Contains(e.mousePosition))
        {
            v.selected = !v.selected;
            GUI.changed = true;
            Repaint();
        }

        // Drag & Drop of prefab / sprite on this card
        if (cardRect.Contains(e.mousePosition))
        {
            if (e.type == EventType.DragUpdated && ContainsPrefabOrSprite(DragAndDrop.objectReferences))
            {
                DragAndDrop.visualMode = DragAndDropVisualMode.Copy;
                e.Use();
            }
            else if (e.type == EventType.DragPerform && ContainsPrefabOrSprite(DragAndDrop.objectReferences))
            {
                DragAndDrop.AcceptDrag();
                HandleDragOnCard(v, DragAndDrop.objectReferences);
                e.Use();
            }
        }
    }

    private bool ContainsPrefabOrSprite(UnityEngine.Object[] objs)
    {
        foreach (var o in objs)
        {
            if (o is GameObject || o is Sprite)
                return true;
        }
        return false;
    }

    private void HandleDragOnCard(IllustratorObjectView target, UnityEngine.Object[] objs)
    {
        GameObject droppedPrefab = null;
        Sprite droppedSprite = null;

        foreach (var obj in objs)
        {
            if (obj is GameObject go && droppedPrefab == null)
                droppedPrefab = go;
            else if (obj is Sprite sp && droppedSprite == null)
                droppedSprite = sp;
        }

        if (droppedPrefab != null)
        {
            AssignPrefabToSelectedOrSingle(droppedPrefab, target);
        }
        else if (droppedSprite != null)
        {
            AssignSpriteToSelectedOrSingle(droppedSprite, target);
        }

        Repaint();
    }

    /// <summary>
    /// If there are selected cards, assign prefab to all selected.
    /// Otherwise assign only to this target card.
    /// </summary>
    private void AssignPrefabToSelectedOrSingle(GameObject prefab, IllustratorObjectView target)
    {
        if (prefab == null || views == null) return;

        bool anySelected = false;
        foreach (var v in views)
        {
            if (v.selected)
            {
                anySelected = true;
                break;
            }
        }

        if (anySelected)
        {
            foreach (var v in views)
            {
                if (!v.selected) continue;
                v.prefab = prefab;
                v.sprite = null;
            }
        }
        else
        {
            target.prefab = prefab;
            target.sprite = null;
        }
    }

    /// <summary>
    /// If there are selected cards, assign sprite to all selected.
    /// Otherwise assign only to this target card.
    /// </summary>
    private void AssignSpriteToSelectedOrSingle(Sprite sprite, IllustratorObjectView target)
    {
        if (sprite == null || views == null) return;

        bool anySelected = false;
        foreach (var v in views)
        {
            if (v.selected)
            {
                anySelected = true;
                break;
            }
        }

        if (anySelected)
        {
            foreach (var v in views)
            {
                if (!v.selected) continue;
                v.sprite = sprite;
                v.prefab = null;
            }
        }
        else
        {
            target.sprite = sprite;
            target.prefab = null;
        }
    }

    #endregion

    #region Right panel

    private void DrawRightPanel()
    {
        EditorGUILayout.LabelField("Import Illustrator Layout", EditorStyles.boldLabel);
        EditorGUILayout.Space(4);

        // JSON path – label then field
        EditorGUILayout.LabelField("JSON Path", EditorStyles.miniLabel);
        jsonPath = EditorGUILayout.TextField(jsonPath);
        if (GUILayout.Button("Browse...", GUILayout.Height(20)))
        {
            string file = EditorUtility.OpenFilePanel("Select JSON", "", "json");
            if (!string.IsNullOrEmpty(file))
                jsonPath = file;
        }

        EditorGUILayout.Space(6);

        // Parent Transform
        EditorGUILayout.LabelField("Parent Transform", EditorStyles.miniLabel);
        parentTransform = (Transform)EditorGUILayout.ObjectField(parentTransform, typeof(Transform), true);

        // Global Prefab
        EditorGUILayout.LabelField("Global Prefab", EditorStyles.miniLabel);
        globalPrefab = (GameObject)EditorGUILayout.ObjectField(globalPrefab, typeof(GameObject), false);

        // Position Scale
        EditorGUILayout.LabelField("Position Scale", EditorStyles.miniLabel);
        positionScale = EditorGUILayout.FloatField(positionScale);

        EditorGUILayout.Space(4);

        // Checkboxes
        flipY = EditorGUILayout.ToggleLeft("Flip Y", flipY);
        useLocalPosition = EditorGUILayout.ToggleLeft("Use Local Position", useLocalPosition);

        EditorGUILayout.Space(6);

        using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(jsonPath)))
        {
            if (GUILayout.Button("Load JSON + Thumbnails", GUILayout.Height(22)))
                LoadJson();
        }

        EditorGUILayout.Space(10);
        EditorGUILayout.LabelField("Summary", EditorStyles.boldLabel);

        int total = views?.Length ?? 0;
        int toCreate = 0;

        if (views != null)
        {
            foreach (var v in views)
            {
                if (v.create) toCreate++;
            }
        }

        EditorGUILayout.LabelField("Total: " + total);
        EditorGUILayout.LabelField("To Create: " + toCreate);

        EditorGUILayout.Space(4);
        EditorGUILayout.HelpBox(
            "Click a card to select/deselect it (like folders).\n" +
            "Drag a Prefab or Sprite from the Project window onto any card.\n" +
            "If some cards are selected, the dropped asset is assigned to ALL selected.\n" +
            "If none are selected, it only applies to the card you dropped on.",
            MessageType.None);

        using (new EditorGUI.DisabledScope(views == null))
        {
            if (GUILayout.Button("Create GameObjects", GUILayout.Height(30)))
                CreateGameObjects();
        }
    }

    #endregion

    #region Loading & creation

    private void LoadJson()
    {
        if (!File.Exists(jsonPath))
        {
            Debug.LogError("JSON not found: " + jsonPath);
            return;
        }

        string json = File.ReadAllText(jsonPath, Encoding.UTF8);
        exportData = JsonUtility.FromJson<IllustratorExportData>(json);

        if (exportData == null || exportData.objects == null)
        {
            Debug.LogError("Invalid JSON.");
            return;
        }

        string baseDir = Path.GetDirectoryName(jsonPath);

        views = new IllustratorObjectView[exportData.objects.Length];

        for (int i = 0; i < exportData.objects.Length; i++)
        {
            var d = exportData.objects[i];
            var view = new IllustratorObjectView { data = d, create = true, selected = false };

            string thumb = Path.Combine(baseDir, d.thumbnail);
            if (File.Exists(thumb))
            {
                byte[] bytes = File.ReadAllBytes(thumb);
                Texture2D tex = new Texture2D(2, 2);
                tex.LoadImage(bytes);
                view.thumbnail = tex;
            }

            views[i] = view;
        }

        Debug.Log("Loaded " + views.Length + " objects.");
    }

    private void CreateGameObjects()
    {
        if (views == null) return;

        Undo.IncrementCurrentGroup();
        int undoGroup = Undo.GetCurrentGroup();

        foreach (var v in views)
        {
            if (!v.create) continue;

            GameObject prefabToUse = v.prefab != null ? v.prefab : globalPrefab;
            string finalName = prefabToUse ? prefabToUse.name :
                               (!string.IsNullOrEmpty(v.data.name) ? v.data.name : "Object");

            GameObject go = prefabToUse
                ? (GameObject)PrefabUtility.InstantiatePrefab(prefabToUse)
                : new GameObject(finalName);

            go.name = finalName;
            Undo.RegisterCreatedObjectUndo(go, "Create Object");

            float x = v.data.x * positionScale;
            float y = v.data.y * positionScale;
            if (flipY) y = -y;

            Vector3 pos = new Vector3(x, y, 0);

            if (parentTransform != null)
            {
                go.transform.SetParent(parentTransform, false);
                if (useLocalPosition)
                    go.transform.localPosition = pos;
                else
                    go.transform.position = parentTransform.TransformPoint(pos);
            }
            else
            {
                go.transform.position = pos;
            }

            go.transform.rotation = Quaternion.Euler(0, 0, -v.data.rotation);

            // Apply sprite if any
            if (v.sprite != null)
            {
                SpriteRenderer sr = go.GetComponentInChildren<SpriteRenderer>();
                if (sr == null)
                    sr = go.AddComponent<SpriteRenderer>();

                sr.sprite = v.sprite;
            }

            ApplyZOrder(go, v.data.zorder);
        }

        Undo.CollapseUndoOperations(undoGroup);
        EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
    }

    private void ApplyZOrder(GameObject go, int zorder)
    {
        var sr = go.GetComponentInChildren<SpriteRenderer>();
        if (sr != null)
        {
            sr.sortingOrder = -zorder;
            return;
        }

        Vector3 p = go.transform.position;
        p.z = -zorder * 0.01f;
        go.transform.position = p;
    }

    #endregion

    private string GetDefaultName(IllustratorObjectView v)
    {
        if (v.prefab != null) return v.prefab.name;
        if (globalPrefab != null) return globalPrefab.name;
        if (!string.IsNullOrEmpty(v.data.name)) return v.data.name;
        return "Object";
    }
}
