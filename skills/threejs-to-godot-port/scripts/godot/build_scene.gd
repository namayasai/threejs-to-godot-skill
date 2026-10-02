extends RefCounted
# Load a .glb written by export-scene.mjs and apply settings.json on top of it.
#
#   const BuildScene := preload("res://tg_port/build_scene.gd")
#   var built := BuildScene.build(parent_node, "/abs/path/scene.glb", settings_dict, {"light_unit": "three"})
#   # built = { "root": Node3D, "camera": Camera3D, "environment": Environment, "lights": [...], "notes": [...], "imported": Node3D }
#
# Lights and cameras that came inside the glTF become transform-only nodes by default (strip_imported = true): the glTF keeps
# the light position but drops its direction, and the intensity arrives without a unit conversion.
# Pass {"strip_imported": false} to keep them (for measuring what the importer does).
# Optional tuning of imported BaseMaterial3D: {"imported_specular": 0.0} sets metallic_specular,
# {"imported_lambert": true} switches the diffuse model from Burley (the Godot default) to Lambert (what three.js uses).

const ApplySettings := preload("res://tg_port/apply_settings.gd")

static func load_glb(path: String) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(path, state)
	if err != OK:
		push_error("glTF import failed (error %d)" % err)
		return null
	return doc.generate_scene(state) as Node3D

static func _strip(node: Node) -> void:
	for child in node.get_children():
		_strip(child)
		if child is Light3D or child is Camera3D:
			# A light/camera can be a transform parent of exported geometry. Keep its
			# slot, name and local transform instead of freeing its entire subtree.
			var placeholder := Node3D.new()
			placeholder.name = child.name
			# Camera3D (and some light nodes) ignores inherited scale. A plain
			# Node3D must keep that flag or meshes below it change world transforms.
			placeholder.set_disable_scale((child as Node3D).is_scale_disabled())
			placeholder.transform = (child as Node3D).transform
			placeholder.top_level = (child as Node3D).top_level
			placeholder.visible = (child as Node3D).visible
			child.replace_by(placeholder, true)
			child.free()

static func _tune_materials(node: Node, options: Dictionary) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var mat := mi.get_active_material(i)
			if mat is BaseMaterial3D:
				var b := mat as BaseMaterial3D
				if options.has("imported_specular"):
					b.metallic_specular = float(options["imported_specular"])
				if bool(options.get("imported_lambert", false)):
					b.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT
	for child in node.get_children():
		_tune_materials(child, options)

static func build(parent: Node, glb_path: String, settings: Dictionary, options: Dictionary = {}) -> Dictionary:
	var root := Node3D.new()
	root.name = "Port"
	parent.add_child(root)
	var imported: Node3D = null
	if glb_path != "":
		imported = load_glb(glb_path)
		if imported == null:
			return {}
		if bool(options.get("strip_imported", true)):
			_strip(imported)
		if options.has("imported_specular") or options.has("imported_lambert"):
			_tune_materials(imported, options)
		root.add_child(imported)
	var result := ApplySettings.apply(root, settings, options)
	result["root"] = root
	result["imported"] = imported
	return result
