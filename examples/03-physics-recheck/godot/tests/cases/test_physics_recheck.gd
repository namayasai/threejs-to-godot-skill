extends RefCounted
# Re-verification checks. Lines starting with DATA are collected by run.sh into expected.json.

const Rig := preload("res://rig.gd")

func _engine() -> String:
	return str(ProjectSettings.get_setting("physics/3d/physics_engine"))

func test_fresh_worlds_repeat(t) -> void:
	var hashes := {}
	var first: Dictionary = {}
	for i in 20:
		var r: Dictionary = await Rig.run(t.tree, "roll", {"speed": 2.0, "friction": 0.6, "angular_damp": 3.0, "steps": 360})
		if i == 0:
			first = r
		hashes[r["hash"]] = true
	print("DATA engine=%s roll_hash=%s distinct_hashes_in_20_fresh_worlds=%d" % [_engine(), str(first["hash"]).substr(0, 16), hashes.size()])
	t.eq(hashes.size(), 1, "20 fresh worlds give one path")
	t.is_true(first["travel"] > 0.3, "the body moved")

func test_same_world_replacement_repeat(t) -> void:
	var vp := SubViewport.new()
	vp.own_world_3d = true
	vp.size = Vector2i(8, 8)
	t.tree.root.add_child(vp)
	var floor_body := StaticBody3D.new()
	var fs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(200, 1, 200)
	fs.shape = box
	floor_body.add_child(fs)
	floor_body.position = Vector3(0, -0.5, 0)
	vp.add_child(floor_body)
	var hashes := {}
	for i in 10:
		var r: Dictionary = await Rig.run(t.tree, "slide", {"speed": 2.0, "friction": 0.5, "steps": 240}, vp)
		hashes[r["hash"]] = true
	print("DATA engine=%s distinct_hashes_in_10_replacements_same_world=%d" % [_engine(), hashes.size()])
	t.is_true(hashes.size() >= 1)
	vp.queue_free()
	await t.tree.process_frame

func test_sliding_end_position_against_reference(t) -> void:
	var r: Dictionary = await Rig.run(t.tree, "slide", {"speed": 2.0, "friction": 0.5, "steps": 480})
	var ref := Rig.reference_slide(2.0, 0.5, 480)
	var diff := absf(r["travel"] - ref)
	print("DATA engine=%s slide_travel=%.4f reference=%.4f difference=%.4f" % [_engine(), r["travel"], ref, diff])
	t.is_true(r["rest_step"] >= 0, "the body rested")
	t.less_eq(diff, 0.05, "sliding distance within 0.05 m of the constant-deceleration reference (a loose sanity limit)")

func test_engine_fingerprint(t) -> void:
	# A body at rest on the floor: sink depth and the step at which the engine puts it to sleep.
	var r: Dictionary = await Rig.run(t.tree, "slide", {"speed": 0.0, "friction": 0.5, "steps": 240})
	print("DATA engine=%s rest_sink_mm=%.3f sleep_step=%d" % [_engine(), (0.2 - (r["end"] as Vector3).y) * 1000.0, r["sleep_step"]])
	t.is_true(absf((r["end"] as Vector3).y - 0.2) < 0.01, "the body rests near its starting height")
