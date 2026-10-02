extends RefCounted
# Example 02: rebuild what the glTF export dropped. Runs after the glTF and settings.json are applied.
#   - MeshToonMaterial (gradientMap, vertex colors) -> toon.gdshader with a nearest-filtered gradient texture
#   - back-face outline shells (imported as body-sized duplicates) -> removed, then a smooth-normal hull + outline.gdshader
#   - HemisphereLight -> hemisphere uniforms of the toon shader (apply_settings.gd leaves it alone: hemisphere = none)
#
# Options understood here (used by the negative controls in run.sh):
#   color_mistake=true   feed the LINEAR color arrays to source_color uniforms (a common mistake)
#   outline=false        do not add outline hulls

const Hull := preload("res://tg_port/hull.gd")
const TOON := preload("res://tg_port/shaders/toon.gdshader")
const OUTLINE := preload("res://tg_port/shaders/outline.gdshader")

static func _color(entry: Dictionary, mistake: bool) -> Color:
	if mistake:
		var l: Array = entry["linear"]
		return Color(l[0], l[1], l[2])
	return Color.html(str(entry["srgb"]))

static func after_build(built: Dictionary, settings: Dictionary, options: Dictionary) -> void:
	var imported: Node = built["imported"]
	var mistake := bool(options.get("color_mistake", false))
	var materials := {}
	for m in settings["materials"]:
		materials[str(m["name"])] = m
	var hemi: Dictionary = {}
	for l in settings["lights"]:
		if str(l["type"]) == "HemisphereLight":
			hemi = l
	# 1. toon materials by mesh name
	for obj in settings["objects"]:
		var name := str(obj["name"])
		if name.ends_with("-outline"):
			continue
		var node := imported.find_child(name, true, false)
		if not (node is MeshInstance3D):
			# Not found by name, or not a MeshInstance3D (an InstancedMesh may arrive as something else). Say so; do not skip silently.
			push_warning("port_hook: '%s' is not a MeshInstance3D in the imported scene; its material was not rebuilt" % name)
			continue
		var entry: Dictionary = materials.get(str(obj["material"]), {})
		if entry.is_empty() or str(entry["type"]) != "MeshToonMaterial":
			continue
		if not entry.has("gradientMap"):
			# dump-settings.mjs could not read the gradient pixels (an image-based gradientMap) and printed a warning.
			push_warning("port_hook: toon material '%s' has no gradientMap values in settings.json; left as imported" % str(entry["name"]))
			continue
		var mat := ShaderMaterial.new()
		mat.shader = TOON
		mat.set_shader_parameter("albedo_color", _color(entry["color"], mistake))
		mat.set_shader_parameter("use_vertex_color", bool(entry["vertexColors"]))
		mat.set_shader_parameter("gradient_map", Hull.gradient_texture(entry["gradientMap"]))
		if not hemi.is_empty():
			mat.set_shader_parameter("sky_color", _color(hemi["color"], mistake))
			mat.set_shader_parameter("ground_color", _color(hemi["groundColor"], mistake))
			mat.set_shader_parameter("hemisphere_energy", float(hemi["intensity"]) / PI)
		(node as MeshInstance3D).set_surface_override_material(0, mat)
	# 2. outline shells: drop the imported duplicates, add real hulls
	var shells: Array = []
	_collect(imported, "-outline", shells)
	for shell in shells:
		var base: Node = shell.get_parent()
		var shell_material: Dictionary = materials.get("outline", {})
		shell.get_parent().remove_child(shell)
		shell.free()
		if not bool(options.get("outline", true)) or not (base is MeshInstance3D):
			continue
		var hull := MeshInstance3D.new()
		hull.name = base.name + "-hull"
		hull.mesh = Hull.smooth_hull((base as MeshInstance3D).mesh)
		var om := ShaderMaterial.new()
		om.shader = OUTLINE
		if not shell_material.is_empty():
			om.set_shader_parameter("outline_color", _color(shell_material["color"], mistake))
		om.set_shader_parameter("thickness_px_at_720", 4.0)   # same as THICKNESS_AT_720 in three/scene.mjs
		hull.material_override = om
		hull.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		base.add_child(hull)

static func _collect(node: Node, suffix: String, out: Array) -> void:
	for child in node.get_children():
		_collect(child, suffix, out)
		if str(child.name).ends_with(suffix):
			out.append(child)
