extends RefCounted
# Example 02: after the hook ran, the toon materials, gradient texture and outline hulls are in place.

const BuildScene := preload("res://tg_port/build_scene.gd")
const Hook := preload("res://port_hook.gd")

func _settings() -> Dictionary:
	return JSON.parse_string(FileAccess.get_file_as_string(OS.get_environment("TG_SETTINGS")))

func _build(options: Dictionary) -> Dictionary:
	var holder := Node.new()
	var settings := _settings()
	var built := BuildScene.build(holder, OS.get_environment("TG_GLB"), settings, options)
	Hook.after_build(built, settings, options)
	built["holder"] = holder
	return built

func test_toon_materials_and_gradient(t) -> void:
	var built := _build({"hemisphere": "none"})
	var imported: Node = built["imported"]
	for n in ["sphere", "cylinder", "vertex-color-box", "ground"]:
		var mesh := imported.find_child(n, true, false) as MeshInstance3D
		t.is_true(mesh != null, n + " exists")
		var mat := mesh.get_surface_override_material(0) as ShaderMaterial
		t.is_true(mat != null and mat.shader.resource_path.ends_with("toon.gdshader"), n + " has the toon shader")
	var sphere := (imported.find_child("sphere", true, false) as MeshInstance3D).get_surface_override_material(0) as ShaderMaterial
	var tex: ImageTexture = sphere.get_shader_parameter("gradient_map")
	var img := tex.get_image()
	t.eq(img.get_width(), 3)
	t.near(img.get_pixel(0, 0).r * 255.0, 102.0, 0.6)
	t.near(img.get_pixel(1, 0).r * 255.0, 178.0, 0.6)
	t.near(img.get_pixel(2, 0).r * 255.0, 255.0, 0.6)
	t.near(float(sphere.get_shader_parameter("hemisphere_energy")), 1.5 / PI, 1e-6)
	var box := (imported.find_child("vertex-color-box", true, false) as MeshInstance3D).get_surface_override_material(0) as ShaderMaterial
	t.eq(box.get_shader_parameter("use_vertex_color"), true)
	t.eq(sphere.get_shader_parameter("use_vertex_color"), false)
	built["holder"].free()

func test_outline_shells_are_replaced_by_hulls(t) -> void:
	var built := _build({"hemisphere": "none"})
	var imported: Node = built["imported"]
	t.eq(imported.find_children("*-outline", "", true, false).size(), 0, "imported duplicate shells are gone")
	for n in ["sphere", "cylinder", "vertex-color-box"]:
		var hull := imported.find_child(n + "-hull", true, false) as MeshInstance3D
		t.is_true(hull != null, n + " has a hull")
		t.eq(hull.cast_shadow, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF)
		var mat := hull.material_override as ShaderMaterial
		t.is_true(mat.shader.resource_path.ends_with("outline.gdshader"))
		t.near(float(mat.get_shader_parameter("thickness_px_at_720")), 4.0, 1e-6)
	built["holder"].free()

func test_hull_normals_are_averaged_at_hard_edges(t) -> void:
	var built := _build({"hemisphere": "none"})
	var hull := (built["imported"] as Node).find_child("vertex-color-box-hull", true, false) as MeshInstance3D
	var arrays := hull.mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	t.is_true(verts.size() > 0)
	for i in verts.size():
		t.near(normals[i].length(), 1.0, 1e-5)
		t.near(absf(normals[i].x), 0.57735, 1e-3, "a box corner normal points along the diagonal")
	built["holder"].free()

func test_outline_option_off_adds_no_hulls(t) -> void:
	var built := _build({"hemisphere": "none", "outline": false})
	t.eq((built["imported"] as Node).find_children("*-hull", "", true, false).size(), 0)
	built["holder"].free()
