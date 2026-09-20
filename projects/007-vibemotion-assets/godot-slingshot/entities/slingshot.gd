class_name Slingshot
extends Node2D
## 弹弓实体（简笔画 Y 形）：主干从分叉点向下着地，两臂向两侧上方张开。
## 原点即分叉点；通过 position 放置。弹弦通过 get_left_tip / get_right_tip 挂接。

@export var trunk_length: float = 167.0   # 主干长度（分叉点向下，着地端）
@export var arm_length: float = 160.0     # 两臂长度（分叉点向上）
@export var arm_spread: float = 35.0      # 臂端水平外展（决定 Y 的张开程度）
@export var line_width: float = 7.0       # 马克笔线宽
@export var ink: Color = Color(0.05, 0.05, 0.05)

func _draw() -> void:
	# 主干：分叉点（原点）向下到着地点
	draw_line(Vector2.ZERO, Vector2(0, trunk_length), ink, line_width + 1.0)
	# 两臂：分叉点向两侧上方
	for side in [-1.0, 1.0]:
		var tip := Vector2(side * arm_spread, -arm_length)
		draw_line(Vector2.ZERO, tip, ink, line_width)

## 左臂顶端（弹弦挂点，全局坐标）
func get_left_tip() -> Vector2:
	return to_global(Vector2(-arm_spread, -arm_length))

## 右臂顶端（弹弦挂点，全局坐标）
func get_right_tip() -> Vector2:
	return to_global(Vector2(arm_spread, -arm_length))

## 皮兜位（两臂顶端中点）：皮筋的初始水平面，小鸟坐在此处
func get_pouch_position() -> Vector2:
	return (get_left_tip() + get_right_tip()) / 2.0

## 分叉点（拉弓锚点，全局坐标）
func get_fork() -> Vector2:
	return global_position
