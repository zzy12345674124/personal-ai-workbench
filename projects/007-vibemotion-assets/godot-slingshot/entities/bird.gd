class_name Bird
extends RigidBody2D
## 小鸟实体（简笔画风）：白圆 + 黑色描边 + 黑眼睛。
## 皮筋模型（愤怒的小鸟式）：
##   拉动时：小鸟固定不动，只有皮筋中点（拉弓点）跟随鼠标；
##   释放时：初速度 ∝ 拉弓偏移量（v = (初始点 - 拉弓点) × 力度），皮筋立即弹回初始状态。

@export var bird_radius: float = 20.0
@export var drag_radius: float = 260.0    # 最大拉距（超出则钳制；地图加宽后调大）
@export var min_pull: float = 15.0        # 最小拉距：低于此值松手视为误触，只回弹不发射
@export var launch_power: float = 9.0     # 发射力度系数（初速度 = 偏移量 × 力度；用户实测 9.0 手感最佳）
@export var ink: Color = Color(0.05, 0.05, 0.05)

var _home := Vector2.ZERO       # 初始位置（皮兜位，小鸟固定在此时被拉弓）
var _pull_point := Vector2.ZERO # 当前拉弓点（皮筋中点；静止时 = 初始位置）
var dragging := false
var _predict_points := PackedVector2Array()   # 弹道预测点（拉弓时实时计算）

# 皮筋回弹模拟（阻尼振荡）：释放后皮筋快速弹回 → 越过静止点 → 回摆 → 收敛
var _rebound_active := false
var _rebound_pos := Vector2.ZERO
var _rebound_vel := Vector2.ZERO

const SPRING_K := 90.0        # 弹性系数（回弹加速度 = k × 位移；越大回弹越快）
const SPRING_DAMP := 8.0      # 阻尼系数（c < 2√k ≈ 19 = 欠阻尼 → 过冲回摆后收敛）

const GRAVITY := Vector2(0, 980.0)   # 重力加速度（与 project.godot 一致）
const PREDICT_STEPS := 50            # 预测采样点数（约 0.83 秒）
const PREDICT_DT := 1.0 / 60.0       # 采样步长（1 物理帧）
const GROUND_Y := 700.0              # 预测线在地面处截断
const PREDICT_COLOR := Color(0.9, 0.25, 0.15)   # 红色虚线

func _ready() -> void:
	_home = position
	_pull_point = _home
	freeze = true              # 初始固定，等玩家拉弓

func _draw() -> void:
	# 白圆 + 黑色马克笔描边 + 两只黑眼睛
	draw_circle(Vector2.ZERO, bird_radius, Color(1, 1, 1))
	draw_arc(Vector2.ZERO, bird_radius, 0, TAU, 32, ink, 4.0)
	draw_circle(Vector2(-7, -5), 3.0, ink)
	draw_circle(Vector2(7, -5), 3.0, ink)
	# 弹道预测虚线（拉弓时显示）
	if _predict_points.size() > 1:
		for i in range(_predict_points.size() - 1):
			draw_dashed_line(
				_predict_points[i],
				_predict_points[i + 1],
				PREDICT_COLOR,
				3.0,
				8.0
			)

## 皮筋挂点（供弹弦实体取用）：拖动时为拉弓点，静止时为初始位置
func get_pull_point() -> Vector2:
	return _pull_point

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			# 仅当小鸟仍在皮兜位时才能拉弓（发射后点击无效，R 重置）
			if position.distance_to(event.position) < 90.0 \
					and position.distance_to(_home) < 50.0:
				dragging = true
				freeze = false   # 解除冻结，让 _integrate_forces 生效
		elif not event.pressed and event.button_index == MOUSE_BUTTON_LEFT and dragging:
			_launch()

# 兜底发射：即使松手事件丢失，只要左键已松开就强制发射
func _physics_process(_delta: float) -> void:
	if dragging and not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_launch()
	# 皮筋回弹模拟：阻尼振荡收敛到静止点
	if _rebound_active:
		var accel := (_home - _rebound_pos) * SPRING_K - _rebound_vel * SPRING_DAMP
		_rebound_vel += accel * _delta
		_rebound_pos += _rebound_vel * _delta
		_pull_point = _rebound_pos
		if _rebound_pos.distance_to(_home) < 2.0 and _rebound_vel.length() < 20.0:
			_rebound_active = false
			_pull_point = _home

# 拖拽期间每物理帧执行：拉弓点跟随鼠标（钳制在最大拉距内），
# 小鸟坐在鞍上：位置 = 拉弓点（一起被拉走）
func _integrate_forces(state: PhysicsDirectBodyState2D) -> void:
	if not dragging:
		return
	var pull := get_global_mouse_position() - _home
	if pull.length() > drag_radius:
		pull = pull.normalized() * drag_radius
	_pull_point = _home + pull
	state.transform.origin = _pull_point
	state.linear_velocity = Vector2.ZERO

# 渲染帧更新预测点：拉弓时实时计算抛物线，松手/静止时清空隐藏
func _process(_delta: float) -> void:
	if not dragging:
		if not _predict_points.is_empty():
			_predict_points = PackedVector2Array()
			queue_redraw()
		return
	_update_predict_points()
	queue_redraw()

func _update_predict_points() -> void:
	# 初速度与 _launch 同一公式（完整弹性反向），逐帧积分重力
	var v0 := (_home - _pull_point) * launch_power
	var pos := _pull_point
	var points := PackedVector2Array()
	for _i in range(PREDICT_STEPS):
		points.append(pos - global_position)   # 转局部坐标
		pos += v0 * PREDICT_DT
		v0 += GRAVITY * PREDICT_DT
		if pos.y > GROUND_Y:
			break
	_predict_points = points

func _launch() -> void:
	dragging = false
	# 完整弹性反向：拉上弹下、拉下弹上、拉左弹右（v = (初始点 - 拉弓点) × 力度）
	var velocity := (_home - _pull_point) * launch_power
	# 启动皮筋回弹动画：从释放位置开始阻尼振荡，不再瞬间归位
	_rebound_active = true
	_rebound_pos = _pull_point
	_rebound_vel = Vector2.ZERO
	# 拉距过小视为误触：只回弹不发射（鸟保持固定）
	if velocity.length() < min_pull * launch_power:
		freeze = true
		return
	freeze = false
	apply_impulse(velocity)
