extends RefCounted

const Capture := preload("res://tg_port/capture_godot.gd")

func test_capture_definition_keeps_full_timeline_and_precise_input(t) -> void:
	var capture := Capture.new()
	var camera := {"position": [0.123456789012345, 1, 5], "lookAt": [0, 0, 0], "fov": 40, "near": 0.1, "far": 50}
	var sheet := {"schema": 1, "size": {"width": 640, "height": 360}, "shots": [
		{"id": "first", "camera": camera, "purpose": "not capture state"},
		{"id": "second", "camera": camera, "at": {"step": 6}},
	]}
	var definition: Dictionary = capture._capture_definition(sheet)
	t.eq(definition["shots"].size(), 2, "the full ordered timeline is recorded")
	t.eq(definition["shots"][0]["at"]["step"], 0, "omitted step is normalized")
	t.eq(definition["shots"][1]["at"]["step"], 6)
	t.is_true(not definition["shots"][0].has("purpose"), "report prose is not capture state")
	var restored: Dictionary = JSON.parse_string(JSON.stringify(definition, "", false, true))
	t.near(float(restored["shots"][0]["camera"]["position"][0]), 0.123456789012345, 1e-16, "the portable JSON sidecar keeps precision")
	capture.free()
