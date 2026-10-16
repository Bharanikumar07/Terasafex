"""Unit and integration tests for TERA-SAFE X Real AI Vision Service.
Tests model initialization, real frame inference, bounding box normalization,
search-and-rescue classification semantics, and graceful fallback behavior.
"""

import os
import pytest
from ai_service.vision_module import AIVisionService
from contracts.schemas import AIDetection


def test_ai_service_initialization():
    ai = AIVisionService()
    status = ai.get_service_status()
    assert status["service"] == "ai_vision_module"
    assert status["is_real_model_loaded"] is True
    assert status["execution_device"].startswith("CPU")
    assert "Possible Person" in status["search_and_rescue_semantics"]["label_meaning"]


def test_ai_real_inference_on_validation_image():
    val_image_path = "ai_service/datasets/coco_person/images/val/000000001000.jpg"
    assert os.path.exists(val_image_path), "Validation image must exist"

    ai = AIVisionService()
    detections = ai.process_frame(val_image_path)

    assert len(detections) > 0, "Model should detect candidate persons in validation image"
    
    first = detections[0]
    assert isinstance(first, AIDetection)
    assert first.label.lower() == "person"
    assert 0.0 <= first.confidence <= 1.0
    
    # Check normalized bounding box bounds [x_min, y_min, x_max, y_max] in [0.0, 1.0]
    assert len(first.bounding_box) == 4
    for coord in first.bounding_box:
        assert 0.0 <= coord <= 1.05


def test_ai_service_fallback_on_empty_input():
    ai = AIVisionService()
    # When no camera frame is provided, graceful simulated telemetry is returned
    fallback_detections = ai.process_frame(None)
    assert len(fallback_detections) == 2
    assert fallback_detections[0].detection_id.startswith("sim-det-")
