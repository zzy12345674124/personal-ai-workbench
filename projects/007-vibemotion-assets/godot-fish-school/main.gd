extends Node3D
## 程序化鱼群：CSG 鱼缸 + ArrayMesh 圆锥鱼 + Boids 三规则 + MultiMesh 批量绘制。

const FISH_COUNT := 72
const TANK_HALF := Vector3(9.0, 4.8, 6.0)
const SEPARATION_RADIUS := 1.35
const ALIGNMENT_RADIUS := 3.2
const COHESION_RADIUS := 4.5
const MIN_SPEED := 1.1
const MAX_SPEED := 3.4

var _positions: Array[Vector3] = []
var _velocities: Array[Vector3] = []
var _phases: Array[float] = []
var _scales: Array[float] = []
var _multi_mesh: MultiMesh
var _camera: Camera3D
var _stats: Label
var _rng := RandomNumberGenerator.new()
var _elapsed := 0.0
var _paused := false


func _ready() -> void:
	_rng.seed = 20260824
	_build_world()
	_build_tank()
	_build_school()
	_build_overlay()


func _build_world() -> void:
	var environment_node := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("#e9f5f5")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("#dff8ff")
	environment.ambient_light_energy = 1.15
	environment_node.environment = environment
	add_child(environment_node)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45.0, -28.0, 0.0)
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	add_child(sun)

	_camera = Camera3D.new()
	_camera.position = Vector3(0.0, 5.0, 20.5)
	_camera.fov = 52.0
	add_child(_camera)
	_camera.look_at(Vector3.ZERO, Vector3.UP)


func _build_tank() -> void:
	# CSGBox3D 作为透明水体/鱼缸体积；正面剔除使相机从外部也能看到缸内。
	var tank := CSGBox3D.new()
	tank.name = "ProceduralTank"
	tank.size = TANK_HALF * 2.0
	var glass := StandardMaterial3D.new()
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.albedo_color = Color(0.16, 0.72, 0.82, 0.11)
	glass.metallic = 0.05
	glass.roughness = 0.18
	glass.cull_mode = BaseMaterial3D.CULL_FRONT
	tank.material = glass
	add_child(tank)

	var edge_material := StandardMaterial3D.new()
	edge_material.albedo_color = Color("#146b78")
	edge_material.roughness = 0.45
	for edge in _tank_edges():
		var bar := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = edge.size
		box.material = edge_material
		bar.mesh = box
		bar.position = edge.position
		add_child(bar)


func _tank_edges() -> Array[Dictionary]:
	var edges: Array[Dictionary] = []
	var t := 0.08
	for y in [-TANK_HALF.y, TANK_HALF.y]:
		for z in [-TANK_HALF.z, TANK_HALF.z]:
			edges.append({"position": Vector3(0, y, z), "size": Vector3(TANK_HALF.x * 2.0, t, t)})
	for x in [-TANK_HALF.x, TANK_HALF.x]:
		for z in [-TANK_HALF.z, TANK_HALF.z]:
			edges.append({"position": Vector3(x, 0, z), "size": Vector3(t, TANK_HALF.y * 2.0, t)})
	for x in [-TANK_HALF.x, TANK_HALF.x]:
		for y in [-TANK_HALF.y, TANK_HALF.y]:
			edges.append({"position": Vector3(x, y, 0), "size": Vector3(t, t, TANK_HALF.z * 2.0)})
	return edges


func _build_school() -> void:
	var fish_mesh := _build_fish_mesh()
	_multi_mesh = MultiMesh.new()
	_multi_mesh.transform_format = MultiMesh.TRANSFORM_3D
	_multi_mesh.use_colors = true
	_multi_mesh.mesh = fish_mesh
	_multi_mesh.instance_count = FISH_COUNT
	var school := MultiMeshInstance3D.new()
	school.name = "FishSchoolMultiMesh"
	school.multimesh = _multi_mesh
	add_child(school)
	_reset_school()


func _build_fish_mesh() -> ArrayMesh:
	# 鱼头朝 -Z：鼻尖 + 椭圆截面组成圆锥体，尾巴是两片三角形。
	var vertices := PackedVector3Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var nose := Vector3(0.0, 0.0, -0.9)
	var ring_z := 0.42
	var segments := 10
	vertices.append(nose)
	colors.append(Color.WHITE)
	for i in range(segments):
		var angle := TAU * float(i) / float(segments)
		vertices.append(Vector3(cos(angle) * 0.34, sin(angle) * 0.22, ring_z))
		colors.append(Color.WHITE)
	for i in range(segments):
		indices.append(0)
		indices.append(1 + i)
		indices.append(1 + ((i + 1) % segments))

	var tail_center := vertices.size()
	vertices.append_array(PackedVector3Array([
		Vector3(0.0, 0.0, 0.35), Vector3(0.0, 0.48, 1.05), Vector3(0.0, -0.48, 1.05),
		Vector3(0.03, 0.0, 0.35), Vector3(0.03, 0.48, 1.05), Vector3(0.03, -0.48, 1.05),
	]))
	for _i in range(6):
		colors.append(Color(0.92, 0.72, 0.28))
	indices.append_array(PackedInt32Array([
		tail_center, tail_center + 1, tail_center + 2,
		tail_center + 3, tail_center + 5, tail_center + 4,
	]))

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	mesh.surface_set_material(0, material)
	return mesh


func _reset_school() -> void:
	_positions.clear()
	_velocities.clear()
	_phases.clear()
	_scales.clear()
	for i in range(FISH_COUNT):
		_positions.append(Vector3(
			_rng.randf_range(-TANK_HALF.x * 0.82, TANK_HALF.x * 0.82),
			_rng.randf_range(-TANK_HALF.y * 0.72, TANK_HALF.y * 0.72),
			_rng.randf_range(-TANK_HALF.z * 0.75, TANK_HALF.z * 0.75)
		))
		var velocity := Vector3(_rng.randf_range(-1.0, 1.0), _rng.randf_range(-0.3, 0.3), _rng.randf_range(-1.0, 1.0))
		_velocities.append(velocity.normalized() * _rng.randf_range(MIN_SPEED, MAX_SPEED))
		_phases.append(_rng.randf_range(0.0, TAU))
		_scales.append(_rng.randf_range(0.72, 1.18))
		_multi_mesh.set_instance_color(i, Color.from_hsv(float(i % 12) / 12.0, 0.58, 0.95))
	_update_transforms()


func _physics_process(delta: float) -> void:
	if _paused:
		return
	_elapsed += delta
	var next_velocities := _velocities.duplicate()
	for i in range(FISH_COUNT):
		var separation := Vector3.ZERO
		var alignment := Vector3.ZERO
		var cohesion := Vector3.ZERO
		var align_count := 0
		var cohesion_count := 0
		for j in range(FISH_COUNT):
			if i == j:
				continue
			var offset := _positions[j] - _positions[i]
			var distance := offset.length()
			if distance < SEPARATION_RADIUS and distance > 0.001:
				separation -= offset.normalized() / maxf(distance, 0.08)
			if distance < ALIGNMENT_RADIUS:
				alignment += _velocities[j]
				align_count += 1
			if distance < COHESION_RADIUS:
				cohesion += _positions[j]
				cohesion_count += 1
		if align_count > 0:
			alignment = alignment / float(align_count) - _velocities[i]
		if cohesion_count > 0:
			cohesion = cohesion / float(cohesion_count) - _positions[i]
		var wander := Vector3(
			sin(_elapsed * 0.73 + _phases[i]),
			sin(_elapsed * 0.49 + _phases[i] * 1.7) * 0.35,
			cos(_elapsed * 0.61 + _phases[i])
		)
		var steering := separation * 2.35 + alignment * 0.62 + cohesion * 0.19
		steering += _boundary_force(_positions[i]) * 3.1 + wander * 0.13
		var velocity := _velocities[i] + steering * delta
		var speed := clampf(velocity.length(), MIN_SPEED, MAX_SPEED)
		next_velocities[i] = velocity.normalized() * speed
	_velocities = next_velocities
	for i in range(FISH_COUNT):
		_positions[i] += _velocities[i] * delta
		_positions[i].x = clampf(_positions[i].x, -TANK_HALF.x + 0.25, TANK_HALF.x - 0.25)
		_positions[i].y = clampf(_positions[i].y, -TANK_HALF.y + 0.25, TANK_HALF.y - 0.25)
		_positions[i].z = clampf(_positions[i].z, -TANK_HALF.z + 0.25, TANK_HALF.z - 0.25)
	_update_transforms()


func _boundary_force(position: Vector3) -> Vector3:
	var force := Vector3.ZERO
	var margin := 2.0
	if position.x > TANK_HALF.x - margin: force.x -= 1.0
	if position.x < -TANK_HALF.x + margin: force.x += 1.0
	if position.y > TANK_HALF.y - margin: force.y -= 1.0
	if position.y < -TANK_HALF.y + margin: force.y += 1.0
	if position.z > TANK_HALF.z - margin: force.z -= 1.0
	if position.z < -TANK_HALF.z + margin: force.z += 1.0
	return force


func _update_transforms() -> void:
	for i in range(FISH_COUNT):
		var direction := _velocities[i].normalized()
		var basis := Basis.looking_at(direction, Vector3.UP).scaled(Vector3.ONE * _scales[i])
		_multi_mesh.set_instance_transform(i, Transform3D(basis, _positions[i]))


func _build_overlay() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	panel.position = Vector2(24, 24)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.96, 0.99, 0.99, 0.91)
	style.border_color = Color("#146b78")
	style.set_border_width_all(2)
	style.set_corner_radius_all(9)
	panel.add_theme_stylebox_override("panel", style)
	layer.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 5)
	panel.add_child(box)
	var title := Label.new()
	title.text = "程序化鱼群 · 72 条"
	title.add_theme_font_size_override("font_size", 20)
	box.add_child(title)
	var rules := Label.new()
	rules.text = "分离  ·  对齐  ·  聚合\n空格：暂停/继续    R：重置鱼群"
	rules.add_theme_font_size_override("font_size", 14)
	box.add_child(rules)
	_stats = Label.new()
	_stats.text = "MultiMesh：1 次批量绘制"
	_stats.add_theme_color_override("font_color", Color("#146b78"))
	box.add_child(_stats)


func _process(_delta: float) -> void:
	var angle := Time.get_ticks_msec() * 0.000035
	_camera.position = Vector3(sin(angle) * 20.5, 5.0, cos(angle) * 20.5)
	_camera.look_at(Vector3.ZERO, Vector3.UP)
	if _stats:
		_stats.text = "MultiMesh：1 次批量绘制    FPS：%d%s" % [Engine.get_frames_per_second(), "    已暂停" if _paused else ""]


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE:
			_paused = not _paused
		elif event.keycode == KEY_R:
			_reset_school()

