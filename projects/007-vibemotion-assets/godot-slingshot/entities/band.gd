class_name Band
extends Node2D
## 弹弦实体：两条皮筋线，从弹弓两臂顶端连到小鸟两侧，每帧跟随。
## 组装：attach_slingshot(弹弓) + attach_bird(小鸟) 后自动工作。

const SlingshotScript := preload("res://entities/slingshot.gd")

@export var band_width: float = 4.0
@export var ink: Color = Color(0.05, 0.05, 0.05)
# 鞍（皮兜）尺寸：半宽与下陷深度 —— 皮筋接到鞍两端，鞍兜住小鸟，三者一体
@export var saddle_half: float = 16.0
@export var saddle_drop: float = 14.0
@export var saddle_rise: float = 5.0

var _slingshot: SlingshotScript
var _bird: RigidBody2D
var _left_band: Line2D
var _right_band: Line2D
var _saddle: Line2D   # 鞍（皮兜）：皮筋中端的 V 形托座，托住小鸟

func _ready() -> void:
	_left_band = Line2D.new()
	_right_band = Line2D.new()
	for band in [_left_band, _right_band]:
		band.width = band_width
		band.default_color = ink
		add_child(band)
	# 鞍：折线 V 形（最后添加，绘制在最上层）
	_saddle = Line2D.new()
	_saddle.width = band_width
	_saddle.default_color = ink
	add_child(_saddle)

func attach_slingshot(slingshot: SlingshotScript) -> void:
	_slingshot = slingshot

func attach_bird(bird: RigidBody2D) -> void:
	_bird = bird

func _process(_delta: float) -> void:
	if _slingshot == null:
		return
	# 皮筋中点 = 小鸟的拉弓点（拖动时跟随鼠标，静止/释放后回到初始）
	var pull_point: Vector2 = _bird.get_pull_point() if _bird else global_position
	# 鞍两端：皮筋的挂点（皮筋接到鞍，鞍兜住鸟，三者一体）
	var left_pin := pull_point + Vector2(-saddle_half, saddle_drop)
	var right_pin := pull_point + Vector2(saddle_half, saddle_drop)
	_left_band.points = PackedVector2Array([
		_slingshot.get_left_tip(),
		left_pin,
	])
	_right_band.points = PackedVector2Array([
		_slingshot.get_right_tip(),
		right_pin,
	])
	# 鞍：V 形皮兜（两端即皮筋挂点）
	_saddle.points = PackedVector2Array([
		left_pin,
		pull_point + Vector2(0, saddle_rise),
		right_pin,
	])
