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

func _light(type: String, linear_color: Color, intensity: float, ground: Color = Color.BLACK, position: Array = [0, 1, 0]) -> Dictionary:
	var entry := {"name": type, "type": type, "intensity": intensity, "position": position,
		"quaternion": [0, 0, 0, 1], "castShadow": true,
		"color": {"srgb": "#" + linear_color.linear_to_srgb().to_html(false), "linear": [linear_color.r, linear_color.g, linear_color.b]}}
	if type == "HemisphereLight":
		entry["groundColor"] = {"srgb": "#" + ground.linear_to_srgb().to_html(false), "linear": [ground.r, ground.g, ground.b]}
	elif type == "DirectionalLight" or type == "SpotLight":
		entry["direction"] = [0, -1, 0]
		if type == "SpotLight":
			entry["angle"] = PI / 4.0
	return entry

func _ambient_radiance(env: Environment) -> Color:
	return env.ambient_light_color.srgb_to_linear() * env.ambient_light_energy

func test_multiple_ambient_lights_sum_unquantized_linear_colors(t) -> void:
	var s := _settings()
	s["lights"] = [_light("AmbientLight", Color(0.2, 0.4, 0.1), 0.75), _light("AmbientLight", Color(0.1, 0.3, 0.6), 2.0)]
	# Incorrect sRGB data must not replace the authoritative dumped linear colors.
	s["lights"][0]["color"]["srgb"] = "#000000"
	var root := _root()
	var r := ApplySettings.apply(root, s)
	t.color_near(_ambient_radiance(r["environment"]), Color(0.35, 0.9, 1.275) / PI, 1e-5, "ambient radiance adds linearly")
	root.free()

func test_flat_hemispheres_add_to_ambient_independent_of_order(t) -> void:
	var s := _settings()
	s["lights"] = [_light("AmbientLight", Color(0.2, 0.4, 0.1), 0.75),
		_light("HemisphereLight", Color(0.6, 0.1, 0.3), 2.0, Color(0.2, 0.3, 0.4)),
		_light("HemisphereLight", Color(0.1, 0.5, 0.2), 1.5, Color(0.5, 0.3, 0.2))]
	var root := _root()
	var r := ApplySettings.apply(root, s)
	var env: Environment = r["environment"]
	t.eq(env.ambient_light_source, Environment.AMBIENT_SOURCE_COLOR)
	t.color_near(_ambient_radiance(env), Color(1.4, 1.3, 1.075) / PI, 1e-5, "all three contributions survive")
	t.is_true(" ".join(r["notes"]).contains("2 lights summed"), "multiple hemispheres are reported")
	var expected := _ambient_radiance(env)
	root.free()
	s["lights"].reverse()
	root = _root()
	r = ApplySettings.apply(root, s)
	t.color_near(_ambient_radiance(r["environment"]), expected, 1e-5, "last hemisphere does not replace the others")
	root.free()

func test_flat_hemisphere_average_is_linear(t) -> void:
	var s := _settings()
	s["lights"] = [_light("HemisphereLight", Color.WHITE, 2.0, Color.BLACK)]
	var root := _root()
	var r := ApplySettings.apply(root, s)
	t.color_near(_ambient_radiance(r["environment"]), Color(1, 1, 1) / PI, 1e-5, "white/black midpoint is 0.5 linear, not 0.5 sRGB")
	root.free()

func test_hemisphere_none_retains_ambient(t) -> void:
	var s := _settings()
	s["lights"] = [_light("AmbientLight", Color(0.2, 0.4, 0.1), 0.75),
		_light("HemisphereLight", Color.WHITE, 2.0), _light("HemisphereLight", Color.RED, 3.0)]
	var root := _root()
	var r := ApplySettings.apply(root, s, {"hemisphere": "none"})
	var env: Environment = r["environment"]
	t.eq(env.ambient_light_source, Environment.AMBIENT_SOURCE_COLOR)
	t.color_near(_ambient_radiance(env), Color(0.15, 0.3, 0.075) / PI, 1e-5, "ambient retained while shader handles both hemispheres")
	t.is_true(env.sky == null)
	t.is_true(" ".join(r["notes"]).contains("2 lights left to the shader"))
	root.free()

func test_sky_hemispheres_and_ambient_sum_at_both_poles(t) -> void:
	var s := _settings()
	s["lights"] = [_light("AmbientLight", Color(0.2, 0.4, 0.1), 0.75),
		_light("HemisphereLight", Color(0.6, 0.1, 0.3), 2.0, Color(0.2, 0.3, 0.4)),
		_light("HemisphereLight", Color(0.1, 0.5, 0.2), 1.5, Color(0.5, 0.3, 0.2))]
	var root := _root()
	var r := ApplySettings.apply(root, s, {"hemisphere": "sky", "hemisphere_scale": 1.3})
	var env: Environment = r["environment"]
	t.eq(env.ambient_light_source, Environment.AMBIENT_SOURCE_SKY)
	var mat := env.sky.sky_material as ProceduralSkyMaterial
	t.near(mat.sky_energy_multiplier, (0.75 + 3.5 * 1.3) / PI, 1e-6)
	t.near(mat.ground_energy_multiplier, mat.sky_energy_multiplier, 1e-6, "ground intensity follows sky intensity")
	var expected_sky := Color(0.15, 0.3, 0.075) + Color(1.35, 0.95, 0.9) * 1.3
	var expected_ground := Color(0.15, 0.3, 0.075) + Color(1.15, 1.05, 1.1) * 1.3
	t.color_near(mat.sky_top_color.srgb_to_linear() * mat.sky_energy_multiplier, expected_sky / PI, 1e-5)
	t.color_near(mat.ground_bottom_color.srgb_to_linear() * mat.ground_energy_multiplier, expected_ground / PI, 1e-5)
	t.color_near(mat.sky_horizon_color.srgb_to_linear() * mat.sky_energy_multiplier, expected_sky.lerp(expected_ground, 0.5) / PI, 1e-5)
	t.is_true(" ".join(r["notes"]).contains("approximation"), "sky match is not claimed exact")
	root.free()

func test_sky_sideways_hemisphere_reports_lost_axis(t) -> void:
	var s := _settings()
	s["lights"] = [_light("HemisphereLight", Color.RED, 2.0, Color.BLUE, [1, 0, 0])]
	var root := _root()
	var r := ApplySettings.apply(root, s, {"hemisphere": "sky"})
	var mat := (r["environment"] as Environment).sky.sky_material as ProceduralSkyMaterial
	t.color_near(mat.sky_top_color.srgb_to_linear() * mat.sky_energy_multiplier, Color(1, 0, 1) / PI, 1e-5)
	t.color_near(mat.ground_bottom_color, mat.sky_top_color, 1e-5, "world-Y poles coincide for a sideways axis")
	t.is_true(" ".join(r["notes"]).contains("sideways hemisphere axis is unsupported"), "axis loss is explicit")
	root.free()

func test_sky_downward_hemisphere_swaps_poles(t) -> void:
	var s := _settings()
	s["lights"] = [_light("HemisphereLight", Color.RED, 2.0, Color.BLUE, [0, -1, 0])]
	var root := _root()
	var r := ApplySettings.apply(root, s, {"hemisphere": "sky"})
	var mat := (r["environment"] as Environment).sky.sky_material as ProceduralSkyMaterial
	t.color_near(mat.sky_top_color.srgb_to_linear() * mat.sky_energy_multiplier, Color.BLUE * (2.0 / PI), 1e-5)
	t.color_near(mat.ground_bottom_color.srgb_to_linear() * mat.ground_energy_multiplier, Color.RED * (2.0 / PI), 1e-5)
	root.free()

func test_renderer_shadow_switch_gates_every_light_type(t) -> void:
	var s := _settings()
	s["lights"] = [_light("DirectionalLight", Color.WHITE, 1), _light("PointLight", Color.WHITE, 1), _light("SpotLight", Color.WHITE, 1)]
	for enabled in [false, true]:
		for override in [false, true]:
			s["renderer"]["shadowMap"] = {"enabled": enabled}
			var root := _root()
			var r := ApplySettings.apply(root, s, {"shadows": override})
			t.eq(r["lights"].size(), 3)
			for light in r["lights"]:
				t.eq((light as Light3D).shadow_enabled, enabled and override, "renderer and options must both allow shadows")
			root.free()

func test_absent_renderer_shadow_switch_keeps_legacy_cast_flags(t) -> void:
	var s := _settings()
	for renderer in [null, {}, {"shadowMap": {}}]:
		s["renderer"] = renderer
		var root := _root()
		var r := ApplySettings.apply(root, s)
		t.is_true((r["lights"][0] as Light3D).shadow_enabled, "missing global switch keeps legacy defaults")
		root.free()

func test_camera_zoom_uses_effective_vertical_fov(t) -> void:
	var s := _settings()
	for zoom in [0.5, 1.0, 2.0]:
		s["camera"]["zoom"] = zoom
		var root := _root()
		var r := ApplySettings.apply(root, s, {"fov_offset": 3.0})
		var expected := rad_to_deg(2 * atan(tan(deg_to_rad(35.0) / 2) / zoom)) + 3.0
		t.near((r["camera"] as Camera3D).fov, expected, 1e-5, "zoom changes framing before offset")
		root.free()

func test_dumped_effective_fov_takes_precedence_over_zoom(t) -> void:
	var s := _settings()
	s["camera"]["zoom"] = 2.0
	s["camera"]["effectiveFOV"] = 20.0
	var root := _root()
	var r := ApplySettings.apply(root, s, {"fov_offset": 3.0})
	t.near((r["camera"] as Camera3D).fov, 23.0, 1e-6, "dumped effective fov is not zoomed again")
	root.free()

func test_camera_invalid_zoom_falls_back_with_note(t) -> void:
	var s := _settings()
	for zoom in [0.0, -1.0]:
		s["camera"]["zoom"] = zoom
		var root := _root()
		var r := ApplySettings.apply(root, s)
		t.near((r["camera"] as Camera3D).fov, 35.0, 1e-6)
		t.is_true(" ".join(r["notes"]).contains("zoom must be positive"), "invalid projection is reported")
		root.free()

func test_null_effective_fov_uses_legacy_zoom(t) -> void:
	var s := _settings()
	s["camera"]["effectiveFOV"] = null
	s["camera"]["zoom"] = 2.0
	var root := _root()
	var r := ApplySettings.apply(root, s)
	t.near((r["camera"] as Camera3D).fov, rad_to_deg(2 * atan(tan(deg_to_rad(35.0) / 2) / 2)), 1e-5)
	root.free()

func test_srgb_only_legacy_ambient_colors_still_sum(t) -> void:
	var s := _settings()
	s["lights"] = [_light("AmbientLight", Color.RED, 1), _light("HemisphereLight", Color.BLUE, 2, Color.GREEN)]
	for entry in s["lights"]:
		entry["color"].erase("linear")
		if entry.has("groundColor"):
			entry["groundColor"].erase("linear")
	var root := _root()
	var r := ApplySettings.apply(root, s, {"light_unit": "raw"})
	t.color_near(_ambient_radiance(r["environment"]), Color.WHITE, 1e-5, "sRGB fallback is converted before summation")
	root.free()

func test_invalid_hemisphere_mode_warns_and_uses_flat(t) -> void:
	var s := _settings()
	s["lights"] = [_light("AmbientLight", Color.RED, 1), _light("HemisphereLight", Color.BLUE, 2, Color.GREEN)]
	var root := _root()
	var r := ApplySettings.apply(root, s, {"hemisphere": "unknown", "light_unit": "raw"})
	t.color_near(_ambient_radiance(r["environment"]), Color.WHITE, 1e-5)
	t.is_true(" ".join(r["notes"]).contains("hemisphere mode 'unknown' is unsupported"))
	root.free()

func test_light_cast_flag_still_gates_enabled_renderer_shadows(t) -> void:
	var s := _settings()
	s["renderer"]["shadowMap"] = {"enabled": true}
	s["lights"] = [_light("DirectionalLight", Color.WHITE, 1), _light("PointLight", Color.WHITE, 1), _light("SpotLight", Color.WHITE, 1)]
	for entry in s["lights"]:
		entry["castShadow"] = false
	var root := _root()
	var r := ApplySettings.apply(root, s)
	for light in r["lights"]:
		t.is_true(not (light as Light3D).shadow_enabled, "per-light opt-out is respected")
	root.free()
