extends RefCounted
# Example 01: what the glTF importer does with this scene (measured, Godot 4.7), and what the port rebuilds.
# Needs TG_SETTINGS and TG_GLB (run-example.sh sets them after export-scene.mjs and dump-settings.mjs ran).

const BuildScene := preload("res://tg_port/build_scene.gd")

func _settings() -> Dictionary:
	return JSON.parse_string(FileAccess.get_file_as_string(OS.get_environment("TG_SETTINGS")))

func _glb() -> String:
	return OS.get_environment("TG_GLB")

func test_importer_facts(t) -> void:
	var holder := Node.new()
	var built := BuildScene.build(holder, _glb(), _settings(), {"strip_imported": false})
	var imported: Node = built["imported"]
	var sun: DirectionalLight3D = imported.find_child("sun", true, false)
	t.is_true(sun != null, "the directional light is imported as DirectionalLight3D")
	# Importer fact 1: the intensity arrives unchanged (three.js intensity 2.5 -> energy 2.5, no unit conversion).
	t.near(sun.light_energy, 2.5, 1e-6, "importer copies the intensity into light_energy")
	# Importer fact 2: the aim is lost. The light keeps its position and has no rotation.
	t.vec_near(sun.position, Vector3(-4, 7, 5), 1e-5, "position survives")
	t.vec_near(-sun.transform.basis.z, Vector3(0, 0, -1), 1e-5, "aim is lost: the light looks along the default -Z")
	# Importer fact 3: shadows are off.
	t.is_true(not sun.shadow_enabled, "shadow_enabled is not carried")
	# Importer fact 4: the AmbientLight is not a light node.
	var ambient := imported.find_child("ambient", true, false)
	t.is_true(ambient != null and not (ambient is Light3D), "AmbientLight becomes a plain node")
	# Importer fact 5: meshes cast shadows by default, materials arrive as StandardMaterial3D with the right color.
	var cube := imported.find_child("cube", true, false) as MeshInstance3D
	t.eq(cube.cast_shadow, GeometryInstance3D.SHADOW_CASTING_SETTING_ON)
	var mat := cube.get_active_material(0) as BaseMaterial3D
	t.color_near(mat.albedo_color, Color.html("#c0392b"), 1.0 / 255.0, "albedo color")
	t.near(mat.roughness, 1.0, 1e-6)
	t.near(mat.metallic, 0.0, 1e-6)
	# Geometry: size and placement survive.
	var aabb := cube.get_aabb()
	t.vec_near(aabb.size, Vector3(1.4, 1.4, 1.4), 1e-4, "cube size")
	t.vec_near(cube.position, Vector3(-1.6, 0.7, 0.0), 1e-5, "cube position")
	var cylinder := imported.find_child("cylinder", true, false) as MeshInstance3D
	t.vec_near(cylinder.get_aabb().size, Vector3(1.2, 1.6, 1.2), 1e-4, "cylinder size")
	holder.free()

func test_port_rebuilds_lights_environment_camera(t) -> void:
	var settings := _settings()
	var holder := Node.new()
	var built := BuildScene.build(holder, _glb(), settings, {})
	var lights: Array = built["lights"]
	t.eq(lights.size(), 1)
	var sun: DirectionalLight3D = lights[0]
	t.near(sun.light_energy, 2.5 / PI, 1e-6, "energy = intensity / PI")
	var d: Array = settings["lights"][0]["direction"]
	t.vec_near(-sun.transform.basis.z, Vector3(d[0], d[1], d[2]), 1e-5, "aim comes from settings.json")
	t.is_true(sun.shadow_enabled)
	var env: Environment = built["environment"]
	t.near(env.ambient_light_energy, 0.8 / PI, 1e-6)
	t.color_near(env.background_color, Color.html("#d6e4ee"), 1e-4)
	var cam: Camera3D = built["camera"]
	t.near(cam.fov, 40.0, 1e-6)
	t.near(cam.far, 100.0, 1e-6)
	t.eq(((built["imported"] as Node).find_children("*", "Light3D", true, false)).size(), 0, "imported lights are stripped")
	holder.free()
