"""多平台评论采集公共运行时。"""

from .core import CollectorError, CollectorStorage, validate_job

__all__ = ["CollectorError", "CollectorStorage", "validate_job"]
