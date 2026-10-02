extends RefCounted
# A very small assertion helper for run_tests.gd (no add-ons).

var failures: Array = []
var checks: int = 0
var current: String = ""
var tree: SceneTree = null   # set by run_tests.gd; tests that need physics frames can `await tree.physics_frame`

func _fail(message: String) -> void:
	failures.append("%s: %s" % [current, message])

func is_true(condition: bool, message: String = "") -> void:
	checks += 1
	if not condition:
		_fail("is_true failed " + message)

func eq(actual: Variant, expected: Variant, message: String = "") -> void:
	checks += 1
	if typeof(actual) != typeof(expected) or actual != expected:
		_fail("expected %s but got %s %s" % [str(expected), str(actual), message])

func near(actual: float, expected: float, epsilon: float, message: String = "") -> void:
	checks += 1
	if not (absf(actual - expected) <= epsilon):
		_fail("expected %s +- %s but got %s %s" % [str(expected), str(epsilon), str(actual), message])

func vec_near(actual: Vector3, expected: Vector3, epsilon: float, message: String = "") -> void:
	checks += 1
	if not (actual - expected).length() <= epsilon:
		_fail("expected %s +- %s but got %s %s" % [str(expected), str(epsilon), str(actual), message])

func color_near(actual: Color, expected: Color, epsilon: float, message: String = "") -> void:
	checks += 1
	if not (absf(actual.r - expected.r) <= epsilon and absf(actual.g - expected.g) <= epsilon and absf(actual.b - expected.b) <= epsilon):
		_fail("expected %s +- %s but got %s %s" % [str(expected), str(epsilon), str(actual), message])

func less(actual: float, limit: float, message: String = "") -> void:
	checks += 1
	if not (actual < limit):
		_fail("expected %s < %s %s" % [str(actual), str(limit), message])

func less_eq(actual: float, limit: float, message: String = "") -> void:
	checks += 1
	if not (actual <= limit):
		_fail("expected %s <= %s %s" % [str(actual), str(limit), message])
