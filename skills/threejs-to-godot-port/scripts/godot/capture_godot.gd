extends Node
# Helper: capture the Godot side of a shot sheet. Needs a window: headless mode does not draw.
#
#   $GODOT --path <project> --scene res://tg_port/capture.tscn --rendering-method forward_plus \
#          --resolution 640x360 --windowed --fixed-fps 120 --audio-driver Dummy -- \
#          --shots <shots.json> --settings <scene.settings.json> --glb <scene.glb> --out <dir> \
#          [--only id1,id2] [--hook res://port_hook.gd] [--opt key=value ...]
#
# Output per shot: <id>.png and <id>.json. Each image is drawn into a SubViewport of the size in shots.json, so the
# size does not depend on the window or on a high-resolution display.
# --probe draws a 64 x 64 test image and checks its center pixel (used by doctor.mjs).
#
# A shot's at.step is the number of physics ticks to wait before that shot, counted from the scene's current state (the scene is
# not reloaded between shots, so steps add up in sheet order). --only limits output but still advances every shot.
# The two draw frames before the image is read add one or two more
# ticks with --fixed-fps 120.
#
# A hook script may define:  static func after_build(built: Dictionary, settings: Dictionary, options: Dictionary) -> void
# It runs after the glTF and the settings are applied; rebuild materials there.

const BuildScene := preload("res://tg_port/build_scene.gd")

func _ready() -> void:
	_run()

func _args() -> Dictionary:
	var out := {"opt": {}}
	var a := OS.get_cmdline_user_args()
	var i := 0
	while i < a.size():
		var key: String = a[i]
		if key == "--probe":
			out["probe"] = true
		elif key == "--opt" and i + 1 < a.size():
			var kv: PackedStringArray = a[i + 1].split("=", true, 1)
			if kv.size() == 2:
				var v: Variant = kv[1]
				if kv[1] == "true" or kv[1] == "false":
					v = kv[1] == "true"
				elif kv[1].is_valid_float():
					v = float(kv[1])
				out["opt"][kv[0]] = v
			i += 1
		elif key.begins_with("--") and i + 1 < a.size():
			out[key.substr(2)] = a[i + 1]
			i += 1
		i += 1
	return out

func _read_json(path: String) -> Variant:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("cannot read %s" % path)
		return null
	return JSON.parse_string(f.get_as_text())

func _fail(message: String) -> void:
	push_error(message)
	get_tree().quit(1)

func _run() -> void:
	var args := _args()
	if args.has("probe"):
		await _probe()
		return
	for key in ["shots", "settings", "out"]:
		if not args.has(key):
			_fail("missing --%s" % key)
			return
	var sheet: Variant = _read_json(str(args["shots"]))
	var settings: Variant = _read_json(str(args["settings"]))
	if not (sheet is Dictionary) or not (settings is Dictionary):
		_fail("could not read shots or settings")
		return
	var size := Vector2i(int(sheet["size"]["width"]), int(sheet["size"]["height"]))
	var out_dir := str(args["out"])
	DirAccess.make_dir_recursive_absolute(out_dir)
	var vp := SubViewport.new()
	vp.size = size
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	var options: Dictionary = args["opt"]
	var built := BuildScene.build(vp, str(args.get("glb", "")), settings, options)
	if built.is_empty():
		_fail("scene build failed")
		return
	if args.has("hook"):
		var hook: GDScript = load(str(args["hook"]))
		if hook == null:
			_fail("cannot load hook %s" % str(args["hook"]))
			return
		hook.after_build(built, settings, options)
	var camera: Camera3D = built["camera"]
	if camera == null:
		_fail("the settings have no camera")
		return
	camera.make_current()
	var only: Dictionary = {}
	if args.has("only"):
		for id in str(args["only"]).split(","):
			only[id] = true
	var failures := 0
	for id in only:
		var found := false
		for shot in sheet["shots"]:
			if str(shot["id"]) == str(id):
				found = true
		if not found:
			_fail("unknown --only shot: %s" % str(id))
			return
	options["capture_definition"] = _capture_definition(sheet)
	for shot in sheet["shots"]:
		var selected := only.is_empty() or only.has(str(shot["id"]))
		if not await _capture(vp, camera, shot, size, out_dir, built, options, selected):
			failures += 1
	get_tree().quit(1 if failures > 0 else 0)

func _capture_definition(sheet: Dictionary) -> Dictionary:
	var timeline: Array = []
	for shot in sheet["shots"]:
		var at: Dictionary = shot.get("at", {})
		timeline.append({"id": shot["id"], "camera": shot["camera"], "at": {"step": int(at.get("step", 0))}})
	return {"schema": 1, "size": sheet["size"], "shots": timeline}

func _capture(vp: SubViewport, camera: Camera3D, shot: Dictionary, size: Vector2i, out_dir: String, built: Dictionary, options: Dictionary, write_capture: bool = true) -> bool:
	var cam: Dictionary = shot["camera"]
	var pos := Vector3(cam["position"][0], cam["position"][1], cam["position"][2])
	var up := Vector3(0, 1, 0)
	if cam.has("up"):
		up = Vector3(cam["up"][0], cam["up"][1], cam["up"][2])
	if cam.has("lookAt"):
		var target := Vector3(cam["lookAt"][0], cam["lookAt"][1], cam["lookAt"][2])
		camera.global_transform = Transform3D(Basis.looking_at(target - pos, up), pos)
	else:
		var q := Quaternion(cam["quaternion"][0], cam["quaternion"][1], cam["quaternion"][2], cam["quaternion"][3]).normalized()
		camera.global_transform = Transform3D(Basis(q), pos)
	camera.fov = float(cam["fov"]) + float(options.get("fov_offset", 0.0))
	camera.near = float(cam["near"])
	camera.far = float(cam["far"])
	var steps := 0
	if shot.has("at") and shot["at"].has("step"):
		steps = int(shot["at"]["step"])
	for i in steps:
		await get_tree().physics_frame
	# Draw twice: the first frame after a pose change can still show the old one.
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	if not write_capture:
		return true
	var img := vp.get_texture().get_image()
	var ok := img.get_size() == size
	if not ok:
		push_error("image size %s differs from the sheet's %s" % [str(img.get_size()), str(size)])
	var id := str(shot["id"])
	var save_error := img.save_png(out_dir.path_join(id + ".png"))
	if save_error != OK:
		push_error("cannot save capture PNG (error %d)" % save_error)
		return false
	var q2 := camera.global_transform.basis.get_rotation_quaternion()
	if q2.w < 0.0:
		q2 = Quaternion(-q2.x, -q2.y, -q2.z, -q2.w)
	var gp := camera.global_position
	var meta := {
		"id": id, "renderer": "godot", "godot": Engine.get_version_info()["string"],
		"rendering": {"method": RenderingServer.get_current_rendering_method(), "driver": RenderingServer.get_current_rendering_driver_name()},
		"physics_engine": str(ProjectSettings.get_setting("physics/3d/physics_engine")),
		"size": {"width": img.get_width(), "height": img.get_height()},
		"camera": {"type": "perspective", "position": [gp.x, gp.y, gp.z], "quaternion": [q2.x, q2.y, q2.z, q2.w], "fov": camera.fov, "near": camera.near, "far": camera.far},
		"notes": built.get("notes", []),
		"captureDefinition": options["capture_definition"],
	}
	var f := FileAccess.open(out_dir.path_join(id + ".json"), FileAccess.WRITE)
	if f == null:
		push_error("cannot save capture sidecar")
		return false
	f.store_string(JSON.stringify(meta, "  ", false, true) + "\n")
	f.close()
	print("captured ", id, " ", img.get_size())
	return ok

func _probe() -> void:
	var vp := SubViewport.new()
	vp.size = Vector2i(64, 64)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color.html("#336699")
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var cam := Camera3D.new()
	vp.add_child(cam)
	cam.make_current()
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := vp.get_texture().get_image()
	var c := img.get_pixel(32, 32)
	var hex := "#%02x%02x%02x" % [int(round(c.r * 255.0)), int(round(c.g * 255.0)), int(round(c.b * 255.0))]
	print("PROBE size=%dx%d center=%s driver=%s" % [img.get_width(), img.get_height(), hex, RenderingServer.get_current_rendering_driver_name()])
	get_tree().quit(0 if hex == "#336699" and img.get_size() == Vector2i(64, 64) else 1)
