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

func _assert_transform(t, actual: Transform3D, expected: Transform3D, label: String) -> void:
	t.vec_near(actual.origin, expected.origin, 1e-5, label + " origin")
	t.vec_near(actual.basis.x, expected.basis.x, 1e-5, label + " basis x")
	t.vec_near(actual.basis.y, expected.basis.y, 1e-5, label + " basis y")
	t.vec_near(actual.basis.z, expected.basis.z, 1e-5, label + " basis z")

func test_stripping_preserves_nested_meshes_and_hierarchy(t) -> void:
	var root := Node3D.new()
	root.name = "scene"
	root.transform = Transform3D(Basis.from_euler(Vector3(0.2, -0.3, 0.1)).scaled(Vector3(2, 3, 4)), Vector3(3, -2, 1))
	var first := Node3D.new()
	first.name = "first"
	root.add_child(first)
	var light := OmniLight3D.new()
	light.name = "lamp"
	light.transform = Transform3D(Basis.from_euler(Vector3(0.1, 0.4, -0.2)), Vector3(-2, 4, 1))
	light.add_to_group("imported_parent")
	root.add_child(light)
	light.owner = root
	var camera := Camera3D.new()
	camera.name = "lens"
	camera.transform = Transform3D(Basis.from_euler(Vector3(-0.3, 0.2, 0.6)), Vector3(1, 2, -3))
	light.add_child(camera)
	camera.owner = root
	var mesh := MeshInstance3D.new()
	mesh.name = "nested_box"
	mesh.mesh = BoxMesh.new()
	mesh.transform = Transform3D(Basis.from_euler(Vector3(0.4, -0.2, 0.2)), Vector3(2, 1, 3))
	camera.add_child(mesh)
	mesh.owner = root
	var last := Node3D.new()
	last.name = "last"
	root.add_child(last)
	t.tree.root.add_child(root)
	var before := mesh.global_transform
	var mesh_local := mesh.transform
	var light_local := light.transform
	var camera_local := camera.transform
	BuildScene._strip(root)
	t.is_true(is_instance_valid(mesh), "descendant mesh must not be freed")
	t.eq(root.find_children("*", "Light3D", true, false).size(), 0)
	t.eq(root.find_children("*", "Camera3D", true, false).size(), 0)
	var lamp := root.get_node_or_null("lamp") as Node3D
	var lens := root.get_node_or_null("lamp/lens") as Node3D
	t.is_true(lamp != null and lens != null, "transform-parent paths survive")
	if lamp != null and lens != null and is_instance_valid(mesh):
		t.eq(lamp.get_class(), "Node3D")
		t.eq(lens.get_class(), "Node3D")
		t.eq(root.get_child(0), first, "first sibling stays first")
		t.eq(root.get_child(1), lamp, "stripped node keeps its sibling slot")
		t.eq(root.get_child(2), last, "last sibling stays last")
		t.eq(mesh.get_parent(), lens, "mesh stays beneath its camera placeholder")
		t.eq(mesh.owner, root, "scene ownership survives")
		t.is_true(lamp.is_in_group("imported_parent"), "parent groups survive")
		_assert_transform(t, lamp.transform, light_local, "light local")
		_assert_transform(t, lens.transform, camera_local, "camera local")
		_assert_transform(t, mesh.transform, mesh_local, "mesh local")
		_assert_transform(t, mesh.global_transform, before, "mesh world")
	root.free()

func test_stripping_preserves_visibility_and_top_level(t) -> void:
	var root := Node3D.new()
	root.position = Vector3(10, 20, 30)
	var camera := Camera3D.new()
	camera.name = "hidden_camera"
	camera.visible = false
	root.add_child(camera)
	camera.top_level = true
	camera.position = Vector3(-4, 2, 7)
	var mesh := MeshInstance3D.new()
	mesh.name = "top_level_mesh"
	mesh.mesh = BoxMesh.new()
	camera.add_child(mesh)
	mesh.top_level = true
	mesh.position = Vector3(1, 2, 3)
	t.tree.root.add_child(root)
	var camera_before := camera.global_transform
	var before := mesh.global_transform
	BuildScene._strip(root)
	var placeholder := root.get_node_or_null("hidden_camera") as Node3D
	t.is_true(placeholder != null, "camera transform parent survives")
	if placeholder == null:
		root.free()
		return
	t.is_true(not placeholder.visible, "placeholder retains visibility")
	t.is_true(placeholder.top_level, "placeholder retains transform independence")
	_assert_transform(t, placeholder.global_transform, camera_before, "top-level camera world")
	t.is_true(is_instance_valid(mesh) and mesh.top_level, "top-level descendant survives")
	if is_instance_valid(mesh):
		_assert_transform(t, mesh.global_transform, before, "top-level mesh world")
	root.free()

func test_glb_round_trip_preserves_mesh_under_light_and_camera(t) -> void:
	var path := OS.get_temp_dir().path_join("tg_port_test_nested.glb")
	var scene := Node3D.new()
	scene.name = "scene"
	var light := OmniLight3D.new()
	light.name = "lamp"
	light.position = Vector3(2, 3, 4)
	scene.add_child(light)
	var camera := Camera3D.new()
	camera.name = "lens"
	camera.position = Vector3(-1, 2, 1)
	light.add_child(camera)
	var box := MeshInstance3D.new()
	box.name = "nested_box"
	box.mesh = BoxMesh.new()
	box.position = Vector3(1, 0, -2)
	camera.add_child(box)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	t.eq(doc.append_from_scene(scene, state), OK)
	t.eq(doc.write_to_filesystem(state, path), OK)
	scene.free()
	var holder := Node.new()
	t.tree.root.add_child(holder)
	var built := BuildScene.build(holder, path, _settings())
	t.is_true(not built.is_empty(), "nested scene builds")
	if not built.is_empty():
		var imported: Node = built["imported"]
		var nested := imported.find_child("nested_box", true, false) as MeshInstance3D
		t.is_true(nested != null, "mesh under light/camera survives the import")
		t.eq(imported.find_children("*", "Light3D", true, false).size(), 0)
		t.eq(imported.find_children("*", "Camera3D", true, false).size(), 0)
		if nested != null:
			t.vec_near(nested.global_position, Vector3(2, 5, 3), 1e-5, "ancestor transforms remain")
	holder.free()
	DirAccess.remove_absolute(path)
