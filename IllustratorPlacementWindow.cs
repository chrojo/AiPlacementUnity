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
    public int zorder;   // Illustrator z-order (0 = back)
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
    public string gameObjectName; // only used when useCustomName = true
    public bool useCustomName = false;

    public Texture2D thumbnail;
    public bool create = true;
    public GameObject prefab; // Per-element prefab
}

#endregion

public class IllustratorPlacementWindow : EditorWindow
{
    private string jsonPath = "";

    private IllustratorExportData exportData;
    private IllustratorObjectView[] views;

    private Transform parentTransform;
    private GameObject globalPrefab; // Prefab applied to all (unless overridden)

    private float positionScale = 0.00651041666f; // Pixel Per Unit 153.6
    private bool flipY = true;
    private bool useLocalPosition = false;

    private Vector2 scroll;

    [MenuItem("Tools/Illustrator Placement Tool")]
    public static void ShowWindow()
    {
        var win = GetWindow<IllustratorPlacementWindow>("Illustrator Placement");
        win.minSize = new Vector2(520, 350);
    }

    private void OnGUI()
    {
        EditorGUILayout.LabelField("Import Illustrator Layout", EditorStyles.boldLabel);

        // JSON path
        EditorGUILayout.BeginHorizontal();
        jsonPath = EditorGUILayout.TextField("JSON File Path", jsonPath);
        if (GUILayout.Button("Browse", GUILayout.Width(80)))
        {
            string file = EditorUtility.OpenFilePanel("Select Illustrator JSON", "", "json");
            if (!string.IsNullOrEmpty(file))
                jsonPath = file;
        }
        EditorGUILayout.EndHorizontal();

        parentTransform = (Transform)EditorGUILayout.ObjectField("Parent Transform", parentTransform, typeof(Transform), true);
        globalPrefab = (GameObject)EditorGUILayout.ObjectField("Global Prefab", globalPrefab, typeof(GameObject), false);

        positionScale = EditorGUILayout.FloatField("Position Scale", positionScale);
        flipY = EditorGUILayout.Toggle("Flip Y", flipY);
        useLocalPosition = EditorGUILayout.Toggle("Use Local Position", useLocalPosition);

        EditorGUILayout.Space();

        using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(jsonPath)))
        {
            if (GUILayout.Button("Load JSON and Thumbnails"))
            {
                LoadJson();
            }
        }

        EditorGUILayout.Space();

        if (exportData == null || views == null)
        {
            EditorGUILayout.HelpBox("Select a JSON file and click Load JSON.", MessageType.Info);
            return;
        }

        EditorGUILayout.LabelField("Layer: " + exportData.layer, EditorStyles.miniBoldLabel);
        EditorGUILayout.Space();

        // Object list panel
        scroll = EditorGUILayout.BeginScrollView(scroll);

        foreach (var v in views)
        {
            EditorGUILayout.BeginVertical("box");
            EditorGUILayout.BeginHorizontal();

            // Thumbnail preview
            if (v.thumbnail != null)
                GUILayout.Label(v.thumbnail, GUILayout.Width(64), GUILayout.Height(64));
            else
                GUILayout.Box("No Image", GUILayout.Width(64), GUILayout.Height(64));

            EditorGUILayout.BeginVertical();

            v.create = EditorGUILayout.Toggle("Create", v.create);

            // Per-element prefab
            v.prefab = (GameObject)EditorGUILayout.ObjectField("Prefab", v.prefab, typeof(GameObject), false);

            // Default name (from prefab/global/Illustrator)
            string defaultName = GetDefaultName(v);
            EditorGUILayout.LabelField("Default Name (from prefab): " + defaultName);

            // Custom name toggle + field
            v.useCustomName = EditorGUILayout.Toggle("Use Custom Name", v.useCustomName);
            if (v.useCustomName)
            {
                v.gameObjectName = EditorGUILayout.TextField("Custom GameObject Name", v.gameObjectName);
            }

            EditorGUILayout.LabelField("Illustrator Name: " + v.data.name);
            EditorGUILayout.LabelField(
                $"Size W/H: {v.data.width:F1} x {v.data.height:F1}");
            EditorGUILayout.LabelField(
                $"Pos: {v.data.x:F1}, {v.data.y:F1}  Rot: {v.data.rotation:F1}  Z: {v.data.zorder}");

            EditorGUILayout.EndVertical();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();
        }

        EditorGUILayout.EndScrollView();

        EditorGUILayout.Space();

        if (GUILayout.Button("Create GameObjects"))
        {
            CreateGameObjects();
        }
    }

    private void LoadJson()
    {
        if (!File.Exists(jsonPath))
        {
            Debug.LogError("JSON file not found: " + jsonPath);
            exportData = null;
            views = null;
            return;
        }

        try
        {
            string jsonText = File.ReadAllText(jsonPath, Encoding.UTF8);
            exportData = JsonUtility.FromJson<IllustratorExportData>(jsonText);
        }
        catch (Exception ex)
        {
            Debug.LogError("JSON parse error: " + ex);
            exportData = null;
            views = null;
            return;
        }

        if (exportData?.objects == null)
        {
            Debug.LogError("Invalid JSON format.");
            exportData = null;
            views = null;
            return;
        }

        string baseDir = Path.GetDirectoryName(jsonPath).Replace("\\", "/");

        views = new IllustratorObjectView[exportData.objects.Length];

        for (int i = 0; i < exportData.objects.Length; i++)
        {
            var data = exportData.objects[i];
            var view = new IllustratorObjectView
            {
                data = data,
                gameObjectName = data.name, // initial value if custom name is enabled
                useCustomName = false,
                create = true,
                prefab = null
            };

            string thumbPath = Path.Combine(baseDir, data.thumbnail).Replace("\\", "/");

            if (File.Exists(thumbPath))
            {
                try
                {
                    byte[] bytes = File.ReadAllBytes(thumbPath);
                    Texture2D tex = new Texture2D(2, 2);
                    tex.LoadImage(bytes);
                    view.thumbnail = tex;
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Failed to load thumbnail: " + thumbPath + "\n" + e);
                }
            }

            views[i] = view;
        }

        Debug.Log("Loaded " + views.Length + " Illustrator objects.");
    }

    private void CreateGameObjects()
    {
        if (views == null)
        {
            Debug.LogError("Nothing loaded.");
            return;
        }

        Undo.IncrementCurrentGroup();
        int undoGroup = Undo.GetCurrentGroup();

        foreach (var v in views)
        {
            if (!v.create) continue;

            // Decide final name
            string defaultName = GetDefaultName(v);
            string finalName;

            if (v.useCustomName && !string.IsNullOrEmpty(v.gameObjectName))
                finalName = v.gameObjectName;
            else
                finalName = defaultName;

            // Choose prefab: per-item override > global > null
            GameObject prefabToUse = v.prefab != null ? v.prefab : globalPrefab;

            GameObject go;
            if (prefabToUse != null)
            {
                go = (GameObject)PrefabUtility.InstantiatePrefab(prefabToUse);
                go.name = finalName;
            }
            else
            {
                go = new GameObject(finalName);
            }

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

            ApplyZOrder(go, v.data.zorder);
        }

        Undo.CollapseUndoOperations(undoGroup);
        EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());

        Debug.Log("GameObjects created successfully.");
    }

    // Default name logic: per-item prefab > global prefab > Illustrator name > fallback
    private string GetDefaultName(IllustratorObjectView v)
    {
        if (v.prefab != null)
            return v.prefab.name;

        if (globalPrefab != null)
            return globalPrefab.name;

        if (!string.IsNullOrEmpty(v.data.name))
            return v.data.name;

        return "Object";
    }

    private void ApplyZOrder(GameObject go, int zorder)
    {
        // If sprite → use sortingOrder
        var sr = go.GetComponentInChildren<SpriteRenderer>();
        if (sr != null)
        {
            // Illustrator zorder: 0 = back, larger = front
            // We want: front = 0, then -1, -2, -3 behind
            sr.sortingOrder = -zorder;
            return;
        }

        // Otherwise use Z position
        var pos = go.transform.position;
        // Front = 0, then -0.01, -0.02, etc. behind
        pos.z = -zorder * 0.01f;
        go.transform.position = pos;
    }
}
