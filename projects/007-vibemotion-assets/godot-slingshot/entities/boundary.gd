class_name MapBoundary
extends Node2D
## 地图边界实体：矩形黑线框 + 四边静态碰撞墙（宽高可配，不锁正方形）。
## 原点 = 地图中心；position 决定地图位置。

@export var width: float = 1280.0
@export var height: float = 720.0
@export var line_width: float = 5.0
@export var wall_thickness: float = 12.0
@export var ink: Color = Color(0.05, 0.05, 0.05)

func _ready() -> void:
	_build_walls()
	queue_redraw()

func _draw() -> void:
	var half_w := width / 2.0
	var half_h := height / 2.0
	draw_rect(Rect2(Vector2(-half_w, -half_h), Vector2(width, height)), ink, false, line_width)

func _build_walls() -> void:
	var half_w := width / 2.0
	var half_h := height / 2.0
	var t := wall_thickness
	var walls := [
		{ "pos": Vector2(0, -half_h), "size": Vector2(width + t, t) },  # 顶墙
		{ "pos": Vector2(0, half_h), "size": Vector2(width + t, t) },   # 底墙
		{ "pos": Vector2(-half_w, 0), "size": Vector2(t, height + t) }, # 左墙
		{ "pos": Vector2(half_w, 0), "size": Vector2(t, height + t) },  # 右墙
	]
	for wall_data in walls:
		var wall := StaticBody2D.new()
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = wall_data.size
		shape.shape = rect
		shape.position = wall_data.pos
		wall.add_child(shape)
		add_child(wall)
