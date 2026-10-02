extends RefCounted
# Round trip: write a small scene to .glb with Godot's own exporter, then load it with build_scene.gd.
# Checks the stripping of imported lights and cameras, and the material tuning options.

const BuildScene := preload("res://tg_port/build_scene.gd")

func _make_glb(path: String) -> void:
	var root := Node3D.new()
	root.name = "scene"
	var box := MeshInstance3D.new()
	box.name = "box"
	box.mesh = BoxMesh.new()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color.html("#c0392b")
	box.mesh.surface_set_material(0, mat)
	root.add_child(box)
	var lamp := OmniLight3D.new()
	lamp.name = "lamp"
	root.add_child(lamp)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	doc.append_from_scene(root, state)
	doc.write_to_filesystem(state, path)
	root.free()

func _settings() -> Dictionary:
	return {"schema": 1, "renderer": null, "camera": {"type": "PerspectiveCamera", "fov": 40.0, "near": 0.1, "far": 50.0, "position": [0, 0, 5], "quaternion": [0, 0, 0, 1]},
		"background": {"type": "color", "srgb": "#000000", "linear": [0, 0, 0]}, "fog": null, "lights": [], "objects": [], "materials": []}

func test_import_strips_lights_by_default(t) -> void:
	var path := OS.get_temp_dir().path_join("tg_port_test_scene.glb")
	_make_glb(path)
	var holder := Node.new()
	var built := BuildScene.build(holder, path, _settings())
	t.is_true(not built.is_empty(), "build succeeded")
	var imported: Node = built["imported"]
	t.is_true(imported.find_child("box", true, false) is MeshInstance3D, "mesh arrives by name")
	var lights := imported.find_children("*", "Light3D", true, false)
	t.eq(lights.size(), 0, "imported lights are stripped")
	holder.free()
	holder = Node.new()
	var kept := BuildScene.build(holder, path, _settings(), {"strip_imported": false})
	t.eq((kept["imported"] as Node).find_children("*", "Light3D", true, false).size(), 1, "kept when asked")
	holder.free()
	DirAccess.remove_absolute(path)

func test_material_tuning_options(t) -> void:
	var path := OS.get_temp_dir().path_join("tg_port_test_scene2.glb")
	_make_glb(path)
	var holder := Node.new()
	var built := BuildScene.build(holder, path, _settings(), {"imported_lambert": true, "imported_specular": 0.0})
	var box := (built["imported"] as Node).find_child("box", true, false) as MeshInstance3D
	var m := box.get_active_material(0) as BaseMaterial3D
	t.eq(m.diffuse_mode, BaseMaterial3D.DIFFUSE_LAMBERT)
	t.near(m.metallic_specular, 0.0, 1e-6)
	t.color_near(m.albedo_color, Color.html("#c0392b"), 1e-3, "albedo survives the glTF round trip")
	holder.free()
	DirAccess.remove_absolute(path)

func test_missing_file_returns_empty(t) -> void:
	var holder := Node.new()
	var built := BuildScene.build(holder, OS.get_temp_dir().path_join("does_not_exist.glb"), _settings())
	t.is_true(built.is_empty())
	holder.free()
