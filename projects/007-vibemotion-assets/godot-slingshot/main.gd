extends Node2D
## 弹弓主控（简笔画风）：组装实体（弹弓/小鸟/目标），绘制皮筋，处理重置。
## 实体逐步迁移中：弹弓已实体化，皮筋/边界/障碍物/小鸟陆续迁移。

const SlingshotScene := preload("res://entities/slingshot.tscn")
const SlingshotScript := preload("res://entities/slingshot.gd")
const BandScene := preload("res://entities/band.tscn")
const BandScript := preload("res://entities/band.gd")
const BoundaryScene := preload("res://entities/boundary.tscn")
const BoundaryScript := preload("res://entities/boundary.gd")
const ObstacleScene := preload("res://entities/obstacle.tscn")
const ObstacleScript := preload("res://entities/obstacle.gd")
const BirdScene := preload("res://entities/bird.tscn")
const BirdScript := preload("res://entities/bird.gd")

## 地图：铺满窗口（1280x720 矩形）
const MAP_CENTER := Vector2(640, 360)
const MAP_WIDTH := 1280.0
const MAP_HEIGHT := 720.0

## 背景点阵：一行 30 个点，列行间距相同（点距 = 宽/30 ≈ 42.7px）
const DOT_COLS := 30
const DOT_SPACING := MAP_WIDTH / DOT_COLS
const DOT_RADIUS := 2.0

const ANCHOR := Vector2(200, 520)     # 弹弓分叉点（放置弹弓实体）
const BIRD_RADIUS := 20.0
const INK := Color(0.05, 0.05, 0.05)      # 马克笔黑
const PAPER := Color(0.96, 0.96, 0.93)    # 淡白纸背景

var boundary: BoundaryScript
var slingshot: SlingshotScript
var band: BandScript
var bird: BirdScript
var obstacles: Array[ObstacleScript] = []
var hit_count := 0

func _ready() -> void:
	_build_boundary()
	_build_ground()
	_build_slingshot()
	_build_targets()
	_spawn_bird()
	band.attach_bird(bird)
	_build_ui()

## ---- 力度调节 UI（滑条实时改 launch_power，预测线同步跟随）----
func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var panel := PanelContainer.new()
	panel.position = Vector2(16, 16)
	layer.add_child(panel)

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.98, 0.98, 0.95)
	style.border_color = INK
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	panel.add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 4)
	panel.add_child(vbox)

	var title := Label.new()
	title.text = "力度"
	title.add_theme_font_size_override("font_size", 16)
	vbox.add_child(title)

	var hbox := HBoxContainer.new()
	hbox.add_theme_constant_override("separation", 8)
	vbox.add_child(hbox)

	var slider := HSlider.new()
	slider.min_value = 5.0
	slider.max_value = 25.0
	slider.step = 0.5
	slider.value = bird.launch_power
	slider.custom_minimum_size = Vector2(170, 0)
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hbox.add_child(slider)

	# 数值显示：滑条右侧同一行，拖动实时更新
	var value_label := Label.new()
	value_label.text = "%.1f" % bird.launch_power
	value_label.add_theme_font_size_override("font_size", 18)
	value_label.add_theme_color_override("font_color", INK)
	value_label.custom_minimum_size = Vector2(44, 0)
	value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hbox.add_child(value_label)

	slider.value_changed.connect(func(value: float) -> void:
		bird.launch_power = value
		value_label.text = "%.1f" % value
	)

## ---- 背景（main 自绘）：淡白纸 + 黑色点阵 ----
func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, Vector2(MAP_WIDTH, MAP_HEIGHT)), PAPER)
	var rows := int(ceil(MAP_HEIGHT / DOT_SPACING))
	var offset := DOT_SPACING / 2.0
	for r in range(rows):
		for c in range(DOT_COLS):
			draw_circle(
				Vector2(offset + c * DOT_SPACING, offset + r * DOT_SPACING),
				DOT_RADIUS,
				INK
			)

## ---- 地图边界：矩形黑线框 + 四边碰撞墙 ----
func _build_boundary() -> void:
	boundary = BoundaryScene.instantiate()
	boundary.position = MAP_CENTER
	boundary.width = MAP_WIDTH
	boundary.height = MAP_HEIGHT
	add_child(boundary)

## ---- 地面：一条粗黑地平线（只在地图宽度内）----
func _build_ground() -> void:
	var ground := StaticBody2D.new()
	var body := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(MAP_WIDTH, 40)
	body.shape = rect
	body.position = Vector2(MAP_CENTER.x, 700)
	ground.add_child(body)

	var line := ColorRect.new()
	line.color = INK
	line.size = Vector2(MAP_WIDTH, 5)
	line.position = Vector2(0, 685)
	line.mouse_filter = Control.MOUSE_FILTER_IGNORE   # 装饰层不拦截鼠标
	ground.add_child(line)
	add_child(ground)

## ---- 弹弓 + 弹弦：实体组装（slingshot.tscn + band.tscn）----
func _build_slingshot() -> void:
	slingshot = SlingshotScene.instantiate()
	slingshot.position = ANCHOR
	add_child(slingshot)

	band = BandScene.instantiate()
	add_child(band)
	band.attach_slingshot(slingshot)

## ---- 障碍物：三个简笔画方块实体（obstacle.tscn）----
func _build_targets() -> void:
	for i in range(3):
		var obstacle: ObstacleScript = ObstacleScene.instantiate()
		obstacle.position = Vector2(850 + i * 110, 620)   # 地图右侧拉开距离
		obstacle.mass = 1.5
		obstacle.can_sleep = false
		obstacle.body_entered.connect(_on_target_hit.bind(obstacle))
		add_child(obstacle)
		obstacles.append(obstacle)

func _on_target_hit(_body: Node, obstacle: ObstacleScript) -> void:
	if obstacle.is_in_group("hit"):
		return
	obstacle.add_to_group("hit")
	obstacle.mark_hit()
	hit_count += 1
	if hit_count >= obstacles.size():
		print("全中！按 R 重开")

## ---- 小鸟实体：组装（初始位置 = 弹弓皮兜位，Y 顶端水平面）----
func _spawn_bird() -> void:
	bird = BirdScene.instantiate()
	bird.position = slingshot.get_pouch_position()
	add_child(bird)

## ---- 重置 ----
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_R:
		get_tree().reload_current_scene()
