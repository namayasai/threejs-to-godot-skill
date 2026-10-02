extends RefCounted
# (c) Build the Godot side of a three.js scene's settings: environment, lights, camera.
# Input: the Dictionary parsed from a settings.json written by dump-settings.mjs.
#
# Usage (from your own script):
#   const ApplySettings := preload("res://tg_port/apply_settings.gd")
#   var result := ApplySettings.apply(root, settings, {"light_unit": "three"})
#   # result = { "camera": Camera3D, "environment": Environment, "lights": [Light3D], "notes": [String] }
#
# Options (all optional):
#   light_unit            "three" (default): Godot energy = three.js intensity / PI. "raw": energy = intensity.
#   light_divisor         a number that overrides light_unit (energy = intensity / light_divisor). For sweeps and calibration.
#   hemisphere            "flat" (default): HemisphereLight becomes a flat ambient color (sky and ground averaged).
#                         "sky": a procedural sky supplies orientation-dependent ambient light.
#                         "none": no ambient light from it (your own shader adds the hemisphere term; see shaders/toon.gdshader).
#   hemisphere_scale      multiplies the hemisphere sky energy (calibration; default 1.0). Used with hemisphere = "sky".
#   shadow_max_distance   directional shadow range in meters (default 40).
#   shadow_mode           "orthogonal", "2_splits" (default), "4_splits".
#   shadow_bias, shadow_normal_bias   Godot values; unset keeps the Godot defaults.
#   point_range           omni/spot range when the three.js light has distance 0 (default 100).
#   fov_offset            degrees added to the camera fov (negative controls and experiments only).
#   shadows               false switches every light's shadows off.
#
# No class_name: preload this file by path. Works headless (nothing here needs a window).

const TONE_MAP := {
	"NoToneMapping": Environment.TONE_MAPPER_LINEAR,
	"LinearToneMapping": Environment.TONE_MAPPER_LINEAR,
	"ReinhardToneMapping": Environment.TONE_MAPPER_REINHARDT,
	"CineonToneMapping": Environment.TONE_MAPPER_FILMIC,
	"ACESFilmicToneMapping": Environment.TONE_MAPPER_ACES,
	"AgXToneMapping": Environment.TONE_MAPPER_AGX,
}

static func _color(entry: Dictionary) -> Color:
	return Color.html(str(entry["srgb"]))

static func _vec3(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))

static func _quat(a: Array) -> Quaternion:
	return Quaternion(float(a[0]), float(a[1]), float(a[2]), float(a[3])).normalized()

static func _looking(direction: Vector3, position: Vector3) -> Transform3D:
	var up := Vector3.UP
	if absf(direction.normalized().dot(up)) > 0.999:
		up = Vector3.FORWARD
	return Transform3D(Basis.looking_at(direction, up), position)

static func apply(root: Node3D, settings: Dictionary, options: Dictionary = {}) -> Dictionary:
	var notes: Array = []
	var unit: String = str(options.get("light_unit", "three"))
	var divisor: float = PI if unit == "three" else 1.0
	if options.has("light_divisor"):
		divisor = float(options["light_divisor"])
	var env := Environment.new()
	var lights: Array = []

	# Background and tone mapping
	var bg: Dictionary = settings.get("background", {"type": "none"})
	if str(bg.get("type", "none")) == "color":
		env.background_mode = Environment.BG_COLOR
		env.background_color = _color(bg)
	else:
		env.background_mode = Environment.BG_COLOR
		env.background_color = Color.BLACK
		notes.append("background type '%s' is not carried; the Godot background is black" % str(bg.get("type", "none")))
	var renderer: Variant = settings.get("renderer", null)
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = 1.0
	if renderer is Dictionary:
		var tone: String = str(renderer.get("toneMapping", "NoToneMapping"))
		if TONE_MAP.has(tone):
			env.tonemap_mode = TONE_MAP[tone]
		else:
			notes.append("tone mapping '%s' has no Godot counterpart; LINEAR is used" % tone)
		if tone != "NoToneMapping":
			env.tonemap_exposure = float(renderer.get("toneMappingExposure", 1.0))
		notes.append("tone mapping %s -> Environment tonemap_mode %d" % [tone, env.tonemap_mode])
	env.ambient_light_source = Environment.AMBIENT_SOURCE_DISABLED

	# Fog
	var fog: Variant = settings.get("fog", null)
	if fog is Dictionary:
		env.fog_enabled = true
		env.fog_light_color = _color(fog["color"])
		if str(fog["type"]) == "Fog":
			env.fog_mode = Environment.FOG_MODE_DEPTH
			env.fog_depth_begin = float(fog["near"])
			env.fog_depth_end = float(fog["far"])
			env.fog_depth_curve = 1.0
			notes.append("Fog near/far -> FOG_MODE_DEPTH begin/end. three.js blends with smoothstep(near, far, depth); the Godot curve is fog_depth_curve. Brightness match not measured")
		else:
			env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
			env.fog_density = float(fog["density"])
			notes.append("FogExp2 density copied to the exponential fog density; three.js uses 1 - exp(-density^2 * depth^2), Godot has its own curve. Brightness match not measured")

	# Lights
	var ambient_sum := Color(0, 0, 0)
	var ambient_count := 0
	var ambient_single: Dictionary = {}
	var sky_light: Dictionary = {}
	for entry in settings.get("lights", []):
		var type := str(entry["type"])
		var intensity := float(entry["intensity"])
		var cast: bool = bool(entry.get("castShadow", false)) and bool(options.get("shadows", true))
		var pos := _vec3(entry["position"])
		match type:
			"DirectionalLight":
				var light := DirectionalLight3D.new()
				light.name = str(entry["name"]) if str(entry["name"]) != "" else "DirectionalLight"
				light.transform = _looking(_vec3(entry["direction"]), pos)
				light.light_color = _color(entry["color"])
				light.light_energy = intensity / divisor
				light.shadow_enabled = cast
				var mode: String = str(options.get("shadow_mode", "2_splits"))
				light.directional_shadow_mode = {"orthogonal": DirectionalLight3D.SHADOW_ORTHOGONAL, "2_splits": DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS, "4_splits": DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS}.get(mode, DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS)
				light.directional_shadow_max_distance = float(options.get("shadow_max_distance", 40.0))
				if options.has("shadow_bias"):
					light.shadow_bias = float(options["shadow_bias"])
				if options.has("shadow_normal_bias"):
					light.shadow_normal_bias = float(options["shadow_normal_bias"])
				root.add_child(light)
				lights.append(light)
				notes.append("%s: energy = intensity %s / %s" % [light.name, str(intensity), "PI" if divisor != 1.0 else "1 (raw)"])
			"PointLight", "SpotLight":
				var is_spot := type == "SpotLight"
				var light3: Light3D = SpotLight3D.new() if is_spot else OmniLight3D.new()
				light3.name = str(entry["name"]) if str(entry["name"]) != "" else type
				var dist := float(entry.get("distance", 0.0))
				var range_value := dist if dist > 0.0 else float(options.get("point_range", 100.0))
				light3.set("%s_range" % ("spot" if is_spot else "omni"), range_value)
				light3.light_color = _color(entry["color"])
				light3.light_energy = intensity / divisor
				light3.shadow_enabled = cast
				if is_spot:
					light3.set("spot_angle", rad_to_deg(float(entry["angle"])))
					light3.transform = _looking(_vec3(entry["direction"]), pos)
				else:
					light3.position = pos
				root.add_child(light3)
				lights.append(light3)
				notes.append("%s: point and spot attenuation and units were not measured; check by eye and by compare-shots" % light3.name)
			"AmbientLight":
				ambient_sum += _color(entry["color"]).srgb_to_linear() * (intensity / divisor)
				ambient_count += 1
				ambient_single = entry
			"HemisphereLight":
				sky_light = entry
			_:
				notes.append("light type '%s' is not carried" % type)
	if ambient_count > 0 and sky_light.is_empty():
		env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		if ambient_count == 1:
			env.ambient_light_color = _color(ambient_single["color"])
			env.ambient_light_energy = float(ambient_single["intensity"]) / divisor
		else:
			# Several ambient lights: sum in linear space, keep the brightest channel as the energy
			var m := maxf(ambient_sum.r, maxf(ambient_sum.g, ambient_sum.b))
			if m > 0.0:
				env.ambient_light_color = Color(ambient_sum.r / m, ambient_sum.g / m, ambient_sum.b / m).linear_to_srgb()
				env.ambient_light_energy = m
		notes.append("AmbientLight -> ambient color, energy = intensity / %s (%d lights)" % ["PI" if divisor != 1.0 else "1 (raw)", ambient_count])
	if not sky_light.is_empty():
		var sky_c := _color(sky_light["color"])
		var ground_c := _color(sky_light["groundColor"])
		var e := float(sky_light["intensity"]) / divisor * float(options.get("hemisphere_scale", 1.0))
		var hemi_mode := str(options.get("hemisphere", "flat"))
		if hemi_mode == "none":
			notes.append("HemisphereLight: left to the shader (hemisphere = none)")
		elif hemi_mode == "sky":
			var mat := ProceduralSkyMaterial.new()
			mat.sky_top_color = sky_c
			mat.sky_horizon_color = sky_c.lerp(ground_c, 0.5)
			mat.ground_horizon_color = sky_c.lerp(ground_c, 0.5)
			mat.ground_bottom_color = ground_c
			mat.sky_energy_multiplier = e   # ambient_light_energy has no effect with a sky source (measured, 4.7); the sky multiplier carries the intensity
			var sky := Sky.new()
			sky.sky_material = mat
			env.sky = sky
			env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
			env.ambient_light_energy = 1.0
			notes.append("HemisphereLight -> procedural sky ambient (orientation dependent), energy = intensity / PI")
		else:
			env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
			env.ambient_light_color = sky_c.lerp(ground_c, 0.5)
			env.ambient_light_energy = e
			notes.append("HemisphereLight -> flat ambient color (sky/ground average); orientation dependence is lost")
	var we := WorldEnvironment.new()
	we.name = "WorldEnvironment"
	we.environment = env
	root.add_child(we)

	# Camera
	var camera: Camera3D = null
	var cam: Variant = settings.get("camera", null)
	if cam is Dictionary:
		camera = Camera3D.new()
		camera.name = "Camera3D"
		if str(cam["type"]) == "PerspectiveCamera":
			camera.projection = Camera3D.PROJECTION_PERSPECTIVE
			camera.keep_aspect = Camera3D.KEEP_HEIGHT
			camera.fov = float(cam["fov"]) + float(options.get("fov_offset", 0.0))
		else:
			notes.append("camera type '%s' was not ported; a perspective camera is used" % str(cam["type"]))
			camera.fov = 50.0
		camera.near = float(cam["near"])
		camera.far = float(cam["far"])
		camera.transform = Transform3D(Basis(_quat(cam["quaternion"])), _vec3(cam["position"]))
		root.add_child(camera)

	# Per-object shadow flags (Godot has no per-mesh receive flag)
	var unmatched: Array = []
	for obj in settings.get("objects", []):
		if bool(obj.get("instanced", false)):
			notes.append("InstancedMesh '%s': how the importer handles it was not measured; its materials and shadow flags may not be applied by name" % str(obj["name"]))
		var node := root.find_child(str(obj["name"]), true, false)
		if node is GeometryInstance3D:
			if not bool(obj["castShadow"]):
				(node as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		elif str(obj["name"]) != "":
			unmatched.append(str(obj["name"]))
	if not unmatched.is_empty():
		notes.append("objects not found in the imported scene (shadow flags not applied): %s" % ", ".join(unmatched))
	return {"camera": camera, "environment": env, "lights": lights, "notes": notes}
