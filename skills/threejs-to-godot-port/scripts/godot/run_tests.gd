extends SceneTree
# A minimal test runner (no add-ons, no class_name).
#
#   $GODOT --headless --path <project> --fixed-fps 120 --script res://tg_port/run_tests.gd [-- --cases res://tests/cases] [--only test_name_prefix]
#
# Loads every res://tests/cases/test_*.gd as one RefCounted class and calls its methods whose names start with test_.
# A test method takes the assertion helper (t.gd) as its only argument and may await physics frames.
# The last line is "ALL TESTS PASSED (n tests, m checks)" or "FAILED (...)". The exit code is 0 or 1.
# --fixed-fps 120 makes physics frames run as fast as possible instead of in real time.

const T := preload("res://tg_port/t.gd")

func _initialize() -> void:
	_main()

func _arg(name: String, default_value: String) -> String:
	var args := OS.get_cmdline_user_args()
	for i in args.size():
		if args[i] == name and i + 1 < args.size():
			return args[i + 1]
	return default_value

func _main() -> void:
	await process_frame
	# The first physics frames after start-up ignore impulses, so tests that use physics should start after a warm-up.
	for i in 3:
		await physics_frame
	var cases_dir := _arg("--cases", "res://tests/cases")
	var only := _arg("--only", "")
	var t := T.new()
	t.tree = self
	var files: Array = []
	var dir := DirAccess.open(cases_dir)
	if dir == null:
		print("FAILED (cannot open %s)" % cases_dir)
		quit(1)
		return
	for f in dir.get_files():
		if f.begins_with("test_") and f.ends_with(".gd"):
			files.append(f)
	files.sort()
	var tests := 0
	var started := Time.get_ticks_msec()
	for f in files:
		if only != "" and not f.begins_with(only):
			continue
		var script: GDScript = load(cases_dir.path_join(f))
		if script == null or not script.can_instantiate():
			t.failures.append("%s: cannot load (parse error)" % f)
			print("FAIL %s (cannot load)" % f)
			continue
		var inst = script.new()
		var names: Array = []
		for m in inst.get_method_list():
			if str(m["name"]).begins_with("test_"):
				names.append(str(m["name"]))
		names.sort()
		for n in names:
			t.current = "%s.%s" % [f.get_basename(), n]
			var before := t.failures.size()
			await inst.call(n, t)
			tests += 1
			print("%s %s" % ["PASS" if t.failures.size() == before else "FAIL", t.current])
	for message in t.failures:
		print("  ", message)
	print("elapsed %.1f s" % ((Time.get_ticks_msec() - started) / 1000.0))
	if t.failures.is_empty():
		print("ALL TESTS PASSED (%d tests, %d checks)" % [tests, t.checks])
		quit(0)
	else:
		print("FAILED (%d failures in %d tests, %d checks)" % [t.failures.size(), tests, t.checks])
		quit(1)
