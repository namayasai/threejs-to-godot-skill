extends RefCounted
# Helpers for toon and outline rebuilds: gradient texture from settings.json, smooth-normal hull meshes.

# gradientMap entry from settings.json -> nearest-filtered L8 texture (the shader reads the r channel).
static func gradient_texture(entry: Dictionary) -> ImageTexture:
	var values: Array = entry["values"]
	var bytes := PackedByteArray()
	for v in values:
		bytes.append(int(v))
	var img := Image.create_from_data(int(entry["width"]), int(entry["height"]), false, Image.FORMAT_L8, bytes)
	return ImageTexture.create_from_image(img)

# A copy of an ArrayMesh whose normals are averaged over vertices that share a position (rounded to 1 mm).
# Surfaces are copied one by one; other vertex attributes are dropped (the hull needs positions and normals only).
static func smooth_hull(mesh: Mesh) -> ArrayMesh:
	var out := ArrayMesh.new()
	for s in mesh.get_surface_count():
		var arrays := mesh.surface_get_arrays(s)
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals := PackedVector3Array()
		normals.resize(verts.size())
		var sums := {}
		for i in verts.size():
			var key := Vector3i(roundi(verts[i].x * 1000.0), roundi(verts[i].y * 1000.0), roundi(verts[i].z * 1000.0))
			var acc: Vector3 = sums.get(key, Vector3.ZERO)
			var n: Vector3 = (arrays[Mesh.ARRAY_NORMAL] as PackedVector3Array)[i]
			sums[key] = acc + n
		for i in verts.size():
			var key := Vector3i(roundi(verts[i].x * 1000.0), roundi(verts[i].y * 1000.0), roundi(verts[i].z * 1000.0))
			normals[i] = (sums[key] as Vector3).normalized()
		var hull_arrays: Array = []
		hull_arrays.resize(Mesh.ARRAY_MAX)
		hull_arrays[Mesh.ARRAY_VERTEX] = verts
		hull_arrays[Mesh.ARRAY_NORMAL] = normals
		if arrays[Mesh.ARRAY_INDEX] != null:
			hull_arrays[Mesh.ARRAY_INDEX] = arrays[Mesh.ARRAY_INDEX]
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, hull_arrays)
	return out
