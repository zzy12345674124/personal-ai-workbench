"""平台专属层注册表。"""

from .bilibili import BilibiliAdapter
from .douyin import DouyinAdapter
from .xiaohongshu import XiaohongshuAdapter

ADAPTERS = {"douyin": DouyinAdapter, "xiaohongshu": XiaohongshuAdapter, "bilibili": BilibiliAdapter}

__all__ = ["ADAPTERS", "BilibiliAdapter", "DouyinAdapter", "XiaohongshuAdapter"]
