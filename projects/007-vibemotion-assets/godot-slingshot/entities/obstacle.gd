class_name Obstacle
extends RigidBody2D
## 障碍物实体：简笔画方块（白底 + 黑马克笔描边 + 左上→右下斜线间隔填充）。
## 命中后描边变红。碰撞体在 obstacle.tscn 中（与 box_size 默认值一致，改尺寸需同步）。

@export var box_size := Vector2(60, 45)
@export var stroke_width: float = 4.0
@export var hatch_spacing: float = 8.0
@export var hatch_width: float = 3.0
@export var ink: Color = Color(0.05, 0.05, 0.05)
@export var hit_ink: Color = Color(0.85, 0.2, 0.12)

var _hit := false

func _ready() -> void:
	add_to_group("obstacle")

func _draw() -> void:
	var half := box_size / 2.0
	var rect := Rect2(-half, box_size)
	# 白底
	draw_rect(rect, Color(1, 1, 1))
	# 左上到右下的斜线间隔填充
	var x := -half.x
	while x <= half.x - box_size.y:
		draw_line(Vector2(x, -half.y), Vector2(x + box_size.y, half.y), ink, hatch_width)
		x += hatch_spacing
	# 黑色马克笔描边（命中后变红）
	draw_rect(rect, hit_ink if _hit else ink, false, stroke_width)

func mark_hit() -> void:
	if _hit:
		return
	_hit = true
	queue_redraw()
