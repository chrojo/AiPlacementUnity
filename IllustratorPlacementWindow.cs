using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

#region Data Models

[Serializable]
public class IllustratorObjectData
{
    public string name;
    public string type;
    public string sourceLayer;

    public float x;
    public float y;
    public float width;
    public float height;
    public float rotation;

    public int zorder;

    public string signature;
    public string shapeSignature;
    public string thumbnail;
}

[Serializable]
public class IllustratorExportData
{
    public string sceneName;
    public string documentName;
    public string exportScope;
    public string artboard;
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
    public bool selected = false;

    public GameObject prefab;
    public Sprite sprite;
}

#endregion

public class IllustratorPlacementWindow : EditorWindow
{
    private string jsonPath = "";

    private IllustratorExportData exportData;
    private IllustratorObjectView[] views;        // all real objects
    private IllustratorObjectView[] displayViews; // one representative per family

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
        {
            if (!string.IsNullOrEmpty(exportData.sceneName))
                EditorGUILayout.LabelField("Scene: " + exportData.sceneName, EditorStyles.miniBoldLabel);

            if (!string.IsNullOrEmpty(exportData.documentName))
                EditorGUILayout.LabelField("Document: " + exportData.documentName, EditorStyles.miniLabel);

            if (!string.IsNullOrEmpty(exportData.artboard))
                EditorGUILayout.LabelField("Artboard: " + exportData.artboard, EditorStyles.miniLabel);

            if (!string.IsNullOrEmpty(exportData.layer))
                EditorGUILayout.LabelField("Layer: " + exportData.layer, EditorStyles.miniLabel);

            if (!string.IsNullOrEmpty(exportData.exportScope))
                EditorGUILayout.LabelField("Scope: " + exportData.exportScope, EditorStyles.miniLabel);
        }

        galleryScroll = EditorGUILayout.BeginScrollView(galleryScroll);

        if (displayViews == null || displayViews.Length == 0)
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

        for (int i = 0; i < displayViews.Length; i += columns)
        {
            EditorGUILayout.BeginHorizontal();
            for (int c = 0; c < columns; c++)
            {
                int index = i + c;
                if (index >= displayViews.Length)
                    break;

                DrawObjectCardCompact(displayViews[index], cardWidth);
            }
            EditorGUILayout.EndHorizontal();
        }

        EditorGUILayout.EndScrollView();
    }

    private void DrawObjectCardCompact(IllustratorObjectView v, float cardWidth)
    {
        Color oldColor = GUI.color;
        if (v.selected)
            GUI.color = new Color(0.24f, 0.24f, 0.24f);

        GUILayout.BeginVertical("box", GUILayout.Width(cardWidth));
        GUI.color = oldColor;

        v.create = GUILayout.Toggle(v.create, "Create", GUILayout.Height(16));

        GUILayout.BeginHorizontal();
        GUILayout.FlexibleSpace();
        GUILayout.Label(v.thumbnail != null ? v.thumbnail : Texture2D.grayTexture,
            GUILayout.Width(40), GUILayout.Height(40));
        GUILayout.FlexibleSpace();
        GUILayout.EndHorizontal();

        string prefabName = v.prefab ? v.prefab.name : "No prefab";
        var prefabNameStyle = new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize = 9,
            alignment = TextAnchor.MiddleCenter,
            normal = { textColor = v.prefab ? Color.white : new Color(1, 1, 1, 0.35f) }
        };
        GUILayout.Label(prefabName, prefabNameStyle);

        string illustratorLabel = string.IsNullOrEmpty(v.data.name) ? "Object" : v.data.name;
        var illustratorStyle = new GUIStyle(EditorStyles.miniLabel)
        {
            fontSize = 8,
            alignment = TextAnchor.MiddleCenter
        };
        GUILayout.Label(illustratorLabel, illustratorStyle);

        if (!string.IsNullOrEmpty(v.data.type))
        {
            GUILayout.Label(v.data.type, new GUIStyle(EditorStyles.miniLabel)
            {
                fontSize = 8,
                alignment = TextAnchor.MiddleCenter
            });
        }

        if (!string.IsNullOrEmpty(v.data.sourceLayer))
        {
            GUILayout.Label(v.data.sourceLayer, new GUIStyle(EditorStyles.miniLabel)
            {
                fontSize = 8,
                alignment = TextAnchor.MiddleCenter
            });
        }

        int familyCount = GetFamilyCount(v);
        GUILayout.Label("Family: " + familyCount, new GUIStyle(EditorStyles.miniLabel)
        {
            fontSize = 8,
            alignment = TextAnchor.MiddleCenter
        });

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
            ApplyPrefabToFamily(v, newPrefab);
        }

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
            ApplySpriteToFamily(v, newSprite);
        }

        GUILayout.EndVertical();

        Rect cardRect = GUILayoutUtility.GetLastRect();

        if (cardRect.Contains(Event.current.mousePosition))
            EditorGUIUtility.AddCursorRect(cardRect, MouseCursor.Link);

        Event e = Event.current;
        if (e.type == EventType.MouseDown && e.button == 0 && cardRect.Contains(e.mousePosition))
        {
            v.selected = !v.selected;
            GUI.changed = true;
            Repaint();
        }

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
            AssignPrefabToSelectedOrSingle(droppedPrefab, target);
        else if (droppedSprite != null)
            AssignSpriteToSelectedOrSingle(droppedSprite, target);

        Repaint();
    }

    private void AssignPrefabToSelectedOrSingle(GameObject prefab, IllustratorObjectView target)
    {
        if (views == null) return;

        bool anySelected = false;
        foreach (var v in displayViews)
        {
            if (v.selected)
            {
                anySelected = true;
                break;
            }
        }

        if (anySelected)
        {
            HashSet<string> selectedFamilyKeys = new HashSet<string>();
            List<IllustratorObjectView> selectedSingles = new List<IllustratorObjectView>();

            foreach (var dv in displayViews)
            {
                if (!dv.selected) continue;

                string key = GetFamilyKey(dv.data);
                if (!string.IsNullOrEmpty(key))
                    selectedFamilyKeys.Add(key);
                else
                    selectedSingles.Add(dv);
            }

            foreach (var v in views)
            {
                string key = GetFamilyKey(v.data);

                if ((!string.IsNullOrEmpty(key) && selectedFamilyKeys.Contains(key)) ||
                    (string.IsNullOrEmpty(key) && selectedSingles.Contains(v)))
                {
                    v.prefab = prefab;
                    if (prefab != null)
                        v.sprite = null;
                }
            }
        }
        else
        {
            ApplyPrefabToFamily(target, prefab);
        }
    }

    private void AssignSpriteToSelectedOrSingle(Sprite sprite, IllustratorObjectView target)
    {
        if (views == null) return;

        bool anySelected = false;
        foreach (var v in displayViews)
        {
            if (v.selected)
            {
                anySelected = true;
                break;
            }
        }

        if (anySelected)
        {
            HashSet<string> selectedFamilyKeys = new HashSet<string>();
            List<IllustratorObjectView> selectedSingles = new List<IllustratorObjectView>();

            foreach (var dv in displayViews)
            {
                if (!dv.selected) continue;

                string key = GetFamilyKey(dv.data);
                if (!string.IsNullOrEmpty(key))
                    selectedFamilyKeys.Add(key);
                else
                    selectedSingles.Add(dv);
            }

            foreach (var v in views)
            {
                string key = GetFamilyKey(v.data);

                if ((!string.IsNullOrEmpty(key) && selectedFamilyKeys.Contains(key)) ||
                    (string.IsNullOrEmpty(key) && selectedSingles.Contains(v)))
                {
                    v.sprite = sprite;
                    if (sprite != null)
                        v.prefab = null;
                }
            }
        }
        else
        {
            ApplySpriteToFamily(target, sprite);
        }
    }

    private void ApplyPrefabToFamily(IllustratorObjectView target, GameObject prefab)
    {
        if (views == null || target == null) return;

        string familyKey = GetFamilyKey(target.data);
        bool appliedToFamily = false;

        if (!string.IsNullOrEmpty(familyKey))
        {
            foreach (var v in views)
            {
                if (GetFamilyKey(v.data) != familyKey) continue;
                v.prefab = prefab;
                if (prefab != null)
                    v.sprite = null;
                appliedToFamily = true;
            }
        }

        if (!appliedToFamily)
        {
            target.prefab = prefab;
            if (prefab != null)
                target.sprite = null;
        }
    }

    private void ApplySpriteToFamily(IllustratorObjectView target, Sprite sprite)
    {
        if (views == null || target == null) return;

        string familyKey = GetFamilyKey(target.data);
        bool appliedToFamily = false;

        if (!string.IsNullOrEmpty(familyKey))
        {
            foreach (var v in views)
            {
                if (GetFamilyKey(v.data) != familyKey) continue;
                v.sprite = sprite;
                if (sprite != null)
                    v.prefab = null;
                appliedToFamily = true;
            }
        }

        if (!appliedToFamily)
        {
            target.sprite = sprite;
            if (sprite != null)
                target.prefab = null;
        }
    }

    private string GetFamilyKey(IllustratorObjectData data)
    {
        if (data == null) return string.Empty;

        if (!string.IsNullOrEmpty(data.shapeSignature))
            return "shape:" + data.shapeSignature;

        if (!string.IsNullOrEmpty(data.signature))
            return "sig:" + data.signature;

        return string.Empty;
    }

    private int GetFamilyCount(IllustratorObjectView target)
    {
        if (views == null || target == null) return 1;

        string familyKey = GetFamilyKey(target.data);
        if (string.IsNullOrEmpty(familyKey))
            return 1;

        int count = 0;
        foreach (var v in views)
        {
            if (GetFamilyKey(v.data) == familyKey)
                count++;
        }

        return Mathf.Max(1, count);
    }

    private void BuildDisplayViews()
    {
        if (views == null || views.Length == 0)
        {
            displayViews = null;
            return;
        }

        var familyMap = new Dictionary<string, IllustratorObjectView>();
        var singles = new List<IllustratorObjectView>();

        foreach (var v in views)
        {
            string familyKey = GetFamilyKey(v.data);

            if (string.IsNullOrEmpty(familyKey))
            {
                singles.Add(v);
                continue;
            }

            if (!familyMap.ContainsKey(familyKey))
                familyMap.Add(familyKey, v);
        }

        var result = new List<IllustratorObjectView>();

        foreach (var kv in familyMap)
            result.Add(kv.Value);

        result.AddRange(singles);

        displayViews = result.ToArray();
    }

    #endregion

    #region Right panel

    private void DrawRightPanel()
    {
        EditorGUILayout.LabelField("Import Illustrator Layout", EditorStyles.boldLabel);
        EditorGUILayout.Space(4);

        EditorGUILayout.LabelField("JSON Path", EditorStyles.miniLabel);
        jsonPath = EditorGUILayout.TextField(jsonPath);
        if (GUILayout.Button("Browse...", GUILayout.Height(20)))
        {
            string file = EditorUtility.OpenFilePanel("Select JSON", "", "json");
            if (!string.IsNullOrEmpty(file))
                jsonPath = file;
        }

        EditorGUILayout.Space(6);

        EditorGUILayout.LabelField("Parent Transform", EditorStyles.miniLabel);
        parentTransform = (Transform)EditorGUILayout.ObjectField(parentTransform, typeof(Transform), true);

        EditorGUILayout.LabelField("Global Prefab", EditorStyles.miniLabel);
        globalPrefab = (GameObject)EditorGUILayout.ObjectField(globalPrefab, typeof(GameObject), false);

        EditorGUILayout.LabelField("Position Scale", EditorStyles.miniLabel);
        positionScale = EditorGUILayout.FloatField(positionScale);

        EditorGUILayout.Space(4);

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

        int totalObjects = views?.Length ?? 0;
        int visibleFamilies = displayViews?.Length ?? 0;
        int toCreate = 0;

        if (views != null)
        {
            foreach (var v in views)
            {
                if (v.create) toCreate++;
            }
        }

        EditorGUILayout.LabelField("Total Objects: " + totalObjects);
        EditorGUILayout.LabelField("Visible Families: " + visibleFamilies);
        EditorGUILayout.LabelField("To Create: " + toCreate);

        EditorGUILayout.Space(4);
        EditorGUILayout.HelpBox(
            "Gallery shows one card per family.\n" +
            "Family priority: shapeSignature → signature → single object.\n" +
            "Assigning a Sprite or Prefab to a card applies it to all real objects in that family.\n" +
            "Scene creation still instantiates all original objects.",
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
            var view = new IllustratorObjectView
            {
                data = d,
                create = true,
                selected = false
            };

            string thumb = Path.Combine(baseDir, d.thumbnail);
            if (File.Exists(thumb))
            {
                byte[] bytes = File.ReadAllBytes(thumb);
                Texture2D tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                tex.LoadImage(bytes);
                view.thumbnail = tex;
            }

            views[i] = view;
        }

        BuildDisplayViews();

        Debug.Log("Loaded " + views.Length + " objects. Displaying " + (displayViews != null ? displayViews.Length : 0) + " families.");
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
            string finalName = GetDefaultName(v);

            GameObject go = prefabToUse != null
                ? (GameObject)PrefabUtility.InstantiatePrefab(prefabToUse)
                : new GameObject(finalName);

            go.name = finalName;
            Undo.RegisterCreatedObjectUndo(go, "Create Illustrator Object");

            float x = v.data.x * positionScale;
            float y = v.data.y * positionScale;
            if (flipY) y = -y;

            Vector3 pos = new Vector3(x, y, 0f);

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

            go.transform.rotation = Quaternion.Euler(0f, 0f, -v.data.rotation);

            if (v.sprite != null)
            {
                SpriteRenderer sr = go.GetComponentInChildren<SpriteRenderer>();
                if (sr == null)
                    sr = go.AddComponent<SpriteRenderer>();

                sr.sprite = v.sprite;
            }

            ApplyIllustratorScale(go, v.data);
            ApplyZOrder(go, v.data.zorder);
        }

        Undo.CollapseUndoOperations(undoGroup);
        EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
    }

    private void ApplyIllustratorScale(GameObject go, IllustratorObjectData data)
    {
        SpriteRenderer sr = go.GetComponentInChildren<SpriteRenderer>();
        if (sr == null || sr.sprite == null)
            return;

        float spriteWorldWidth = sr.sprite.rect.width / sr.sprite.pixelsPerUnit;
        float spriteWorldHeight = sr.sprite.rect.height / sr.sprite.pixelsPerUnit;

        if (spriteWorldWidth <= 0f || spriteWorldHeight <= 0f)
            return;

        float targetWorldWidth = data.width * positionScale;
        float targetWorldHeight = data.height * positionScale;

        float scaleX = targetWorldWidth / spriteWorldWidth;
        float scaleY = targetWorldHeight / spriteWorldHeight;

        go.transform.localScale = new Vector3(scaleX, scaleY, 1f);
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