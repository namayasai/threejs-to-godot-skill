extends RefCounted
# Unit tests for apply_settings.gd with hand-written settings (no browser needed).

const ApplySettings := preload("res://tg_port/apply_settings.gd")

func _settings() -> Dictionary:
	return {
		"schema": 1,
		"renderer": {"toneMapping": "NoToneMapping", "toneMappingExposure": 1.0},
		"camera": {"type": "PerspectiveCamera", "fov": 35.0, "near": 0.2, "far": 80.0,
			"position": [1.0, 2.0, 3.0], "quaternion": [0.0, 0.0, 0.0, 1.0]},
		"background": {"type": "color", "srgb": "#336699", "linear": [0.0331, 0.1329, 0.3185]},
		"fog": null,
		"lights": [
			{"name": "sun", "type": "DirectionalLight", "color": {"srgb": "#ffffff", "linear": [1, 1, 1]}, "intensity": 3.0,
				"position": [0.0, 10.0, 0.0], "quaternion": [0, 0, 0, 1], "castShadow": true, "direction": [0.0, -1.0, 0.0]},
			{"name": "fill", "type": "AmbientLight", "color": {"srgb": "#808080", "linear": [0.2158, 0.2158, 0.2158]}, "intensity": 0.6,
				"position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "castShadow": false},
		],
		"objects": [],
		"materials": [],
	}

func _root() -> Node3D:
	return Node3D.new()

func test_directional_energy_is_intensity_over_pi(t) -> void:
	var root := _root()
	var r := ApplySettings.apply(root, _settings())
	var lights: Array = r["lights"]
	t.eq(lights.size(), 1)
	var sun: DirectionalLight3D = lights[0]
	t.near(sun.light_energy, 3.0 / PI, 1e-6, "energy")
	t.is_true(sun.shadow_enabled, "shadow follows castShadow")
	# a light looks along -Z of its basis; the settings say it looks straight down
	t.vec_near(-sun.transform.basis.z, Vector3(0, -1, 0), 1e-5, "aim")
	root.free()

func test_raw_unit_and_divisor_override(t) -> void:
	var root := _root()
	var r := ApplySettings.apply(root, _settings(), {"light_unit": "raw"})
	t.near((r["lights"][0] as DirectionalLight3D).light_energy, 3.0, 1e-6, "raw")
	root.free()
	root = _root()
	r = ApplySettings.apply(root, _settings(), {"light_divisor": 2.0})
	t.near((r["lights"][0] as DirectionalLight3D).light_energy, 1.5, 1e-6, "divisor wins")
	root.free()

func test_ambient_and_background(t) -> void:
	var root := _root()
	var r := ApplySettings.apply(root, _settings())
	var env: Environment = r["environment"]
	t.eq(env.ambient_light_source, Environment.AMBIENT_SOURCE_COLOR)
	t.near(env.ambient_light_energy, 0.6 / PI, 1e-6)
	t.color_near(env.ambient_light_color, Color.html("#808080"), 1e-4)
	t.eq(env.background_mode, Environment.BG_COLOR)
	t.color_near(env.background_color, Color.html("#336699"), 1e-4)
	t.eq(env.tonemap_mode, Environment.TONE_MAPPER_LINEAR)
	root.free()

func test_camera(t) -> void:
	var root := _root()
	var r := ApplySettings.apply(root, _settings(), {"fov_offset": 5.0})
	var cam: Camera3D = r["camera"]
	t.near(cam.fov, 40.0, 1e-6, "fov plus offset")
	t.eq(cam.keep_aspect, Camera3D.KEEP_HEIGHT)
	t.near(cam.near, 0.2, 1e-6)
	t.near(cam.far, 80.0, 1e-6)
	t.vec_near(cam.position, Vector3(1, 2, 3), 1e-6)
	root.free()

func test_missing_camera_gives_null_and_a_note(t) -> void:
	var s := _settings()
	s["camera"] = null
	var root := _root()
	var r := ApplySettings.apply(root, s)
	t.is_true(r["camera"] == null)
	root.free()

func test_hemisphere_modes(t) -> void:
	var s := _settings()
	s["lights"] = [{"name": "sky", "type": "HemisphereLight", "color": {"srgb": "#ffffff", "linear": [1, 1, 1]},
		"groundColor": {"srgb": "#000000", "linear": [0, 0, 0]}, "intensity": 2.0, "position": [0, 1, 0], "quaternion": [0, 0, 0, 1], "castShadow": false}]
	var root := _root()
	var flat := ApplySettings.apply(root, s)
	t.eq((flat["environment"] as Environment).ambient_light_source, Environment.AMBIENT_SOURCE_COLOR)
	t.near((flat["environment"] as Environment).ambient_light_energy, 2.0 / PI, 1e-6)
	root.free()
	root = _root()
	var sky := ApplySettings.apply(root, s, {"hemisphere": "sky"})
	t.eq((sky["environment"] as Environment).ambient_light_source, Environment.AMBIENT_SOURCE_SKY)
	root.free()
	root = _root()
	var none := ApplySettings.apply(root, s, {"hemisphere": "none"})
	t.eq((none["environment"] as Environment).ambient_light_source, Environment.AMBIENT_SOURCE_DISABLED)
	root.free()

func test_fog_and_tone_mapping(t) -> void:
	var s := _settings()
	s["fog"] = {"type": "Fog", "color": {"srgb": "#cccccc", "linear": [0.6, 0.6, 0.6]}, "near": 5.0, "far": 50.0}
	s["renderer"] = {"toneMapping": "ACESFilmicToneMapping", "toneMappingExposure": 0.8}
	var root := _root()
	var r := ApplySettings.apply(root, s)
	var env: Environment = r["environment"]
	t.is_true(env.fog_enabled)
	t.eq(env.fog_mode, Environment.FOG_MODE_DEPTH)
	t.near(env.fog_depth_begin, 5.0, 1e-6)
	t.near(env.fog_depth_end, 50.0, 1e-6)
	t.eq(env.tonemap_mode, Environment.TONE_MAPPER_ACES)
	t.near(env.tonemap_exposure, 0.8, 1e-6)
	root.free()

func test_unsupported_light_type_is_reported(t) -> void:
	var s := _settings()
	s["lights"] = [{"name": "panel", "type": "RectAreaLight", "color": {"srgb": "#ffffff", "linear": [1, 1, 1]}, "intensity": 1.0,
		"position": [0, 0, 0], "quaternion": [0, 0, 0, 1], "castShadow": false}]
	var root := _root()
	var r := ApplySettings.apply(root, s)
	t.eq((r["lights"] as Array).size(), 0)
	var joined := " ".join(r["notes"])
	t.is_true(joined.contains("RectAreaLight"), "a note names the light type")
	root.free()

func test_shadow_flags_by_name(t) -> void:
	var s := _settings()
	s["objects"] = [{"name": "a", "material": "m", "castShadow": false, "receiveShadow": true, "instanced": false},
		{"name": "missing", "material": "m", "castShadow": true, "receiveShadow": true, "instanced": false}]
	var root := _root()
	var mesh := MeshInstance3D.new()
	mesh.name = "a"
	root.add_child(mesh)
	var r := ApplySettings.apply(root, s)
	t.eq(mesh.cast_shadow, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF)
	t.is_true(" ".join(r["notes"]).contains("missing"), "unmatched names are reported")
	root.free()

func test_instanced_mesh_is_reported(t) -> void:
	var s := _settings()
	s["objects"] = [{"name": "crowd", "material": "m", "castShadow": true, "receiveShadow": true, "instanced": true}]
	var root := _root()
	var r := ApplySettings.apply(root, s)
	t.is_true(" ".join(r["notes"]).contains("InstancedMesh 'crowd'"), "an InstancedMesh gets its own note")
	root.free()
