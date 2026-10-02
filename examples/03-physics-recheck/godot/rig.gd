extends RefCounted
# A small physics rig for re-verification: one floor, one body, scripted launch, per-step samples.
# Each run lives in its own SubViewport with its own 3D world (own physics space).

const STEP_HZ := 120.0

# kind: "slide" (a box sliding on the floor) or "roll" (a cylinder lying on its side)
# params: speed (m/s), friction, angular_damp, bounce, steps
static func run(tree: SceneTree, kind: String, params: Dictionary, world: SubViewport = null) -> Dictionary:
	var own_world := world == null
	var vp := world
	if own_world:
		vp = SubViewport.new()
		vp.own_world_3d = true
		vp.size = Vector2i(8, 8)
		tree.root.add_child(vp)
		var floor_body := StaticBody3D.new()
		var floor_shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(200, 1, 200)
		floor_shape.shape = box
		floor_body.add_child(floor_shape)
		floor_body.position = Vector3(0, -0.5, 0)
		var floor_mat := PhysicsMaterial.new()
		floor_mat.friction = 1.0
		floor_mat.bounce = 0.0
		floor_body.physics_material_override = floor_mat
		vp.add_child(floor_body)
	var body := RigidBody3D.new()
	var shape := CollisionShape3D.new()
	if kind == "slide":
		var b := BoxShape3D.new()
		b.size = Vector3(0.4, 0.4, 0.4)
		shape.shape = b
		body.position = Vector3(0, 0.2005, 0)
	else:
		var c := CylinderShape3D.new()
		c.radius = 0.2
		c.height = 0.6
		shape.shape = c
		body.rotation = Vector3(0, 0, PI / 2.0)   # lying on its side, axis along x
		body.position = Vector3(0, 0.2005, 0)
	body.add_child(shape)
	var mat := PhysicsMaterial.new()
	mat.friction = float(params.get("friction", 0.5))
	mat.bounce = float(params.get("bounce", 0.0))
	body.physics_material_override = mat
	body.mass = 1.0
	body.angular_damp = float(params.get("angular_damp", 0.0))
	body.linear_damp = 0.0
	body.continuous_cd = true
	body.can_sleep = true
	vp.add_child(body)
	# The first physics frames after a world exists can swallow an impulse, so wait before launching.
	for i in 3:
		await tree.physics_frame
	var speed := float(params.get("speed", 2.0))
	body.apply_central_impulse(Vector3(0, 0, -speed) * body.mass)   # launch along -z
	var steps := int(params.get("steps", 480))
	var sha := HashingContext.new()
	sha.start(HashingContext.HASH_SHA256)
	var rest_step := -1
	var slow := 0
	var sleep_step := -1
	var start := body.global_position
	for s in steps:
		await tree.physics_frame
		var p := body.global_position
		var v := body.linear_velocity
		sha.update(("%.9f,%.9f,%.9f,%.9f,%.9f,%.9f;" % [p.x, p.y, p.z, v.x, v.y, v.z]).to_utf8_buffer())
		if body.sleeping and sleep_step < 0:
			sleep_step = s
		if v.length() < 0.08:
			slow += 1
			if slow >= int(0.25 * STEP_HZ) and rest_step < 0:
				rest_step = s - slow + 1
		else:
			slow = 0
	var end := body.global_position
	var result := {"hash": sha.finish().hex_encode(), "end": end, "travel": (end - start).length(), "rest_step": rest_step, "sleep_step": sleep_step,
		"bottom": end.y - (0.2 if kind == "slide" else 0.2)}
	body.queue_free()
	if own_world:
		vp.queue_free()
	await tree.process_frame
	return result

# Reference: the project's own fixed-step calculation (constant deceleration mu * g), semi-implicit like a typical game loop.
static func reference_slide(speed: float, friction: float, steps: int) -> float:
	var x := 0.0
	var v := speed
	var dt := 1.0 / STEP_HZ
	for i in steps:
		v = maxf(0.0, v - friction * 9.8 * dt)
		x += v * dt
	return x
