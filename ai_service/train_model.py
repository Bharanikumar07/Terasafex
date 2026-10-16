"""TERA-SAFE X: Model Training & Evaluation Pipeline
Uses Ultralytics YOLOv8n (nano detector) transfer-learning optimized for low-resource CPU execution.
Configurable epochs, batch size, image dimensions, output directories.
"""

import os
import sys
import argparse
from ultralytics import YOLO

def train_model(
    data_yaml: str = "ai_service/datasets/coco_person/data.yaml",
    pretrained_weights: str = "yolov8n.pt",
    epochs: int = 3,
    imgsz: int = 320,
    batch_size: int = 2,
    project: str = "ai_service/runs",
    name: str = "tera_person_exp1"
):
    print(f"--- Starting TERA X Training Pipeline ---")
    print(f"Base Model: {pretrained_weights}")
    print(f"Data config: {data_yaml}")
    print(f"Epochs: {epochs}, Imgsz: {imgsz}, Batch: {batch_size}, Device: cpu")

    model = YOLO(pretrained_weights)

    # Train model
    results = model.train(
        data=os.path.abspath(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch_size,
        device="cpu",
        project=os.path.abspath(project),
        name=name,
        workers=0,
        exist_ok=True,
        verbose=True
    )

    print(f"Training completed successfully.")
    best_checkpoint = os.path.join(project, name, "weights", "best.pt")
    if not os.path.exists(best_checkpoint):
        best_checkpoint = os.path.join(project, name, "weights", "last.pt")
    
    print(f"Best/Last Checkpoint: {best_checkpoint}")

    # Evaluate on validation split
    print("\n--- Running Evaluation on Validation Split ---")
    val_metrics = model.val(
        data=os.path.abspath(data_yaml),
        split="val",
        imgsz=imgsz,
        batch=batch_size,
        device="cpu",
        project=os.path.abspath(project),
        name=f"{name}_val",
        workers=0
    )

    print(f"\n--- Evaluation Results ---")
    print(f"Precision: {val_metrics.results_dict.get('metrics/precision(B)', 0):.4f}")
    print(f"Recall: {val_metrics.results_dict.get('metrics/recall(B)', 0):.4f}")
    print(f"mAP@0.5: {val_metrics.results_dict.get('metrics/mAP50(B)', 0):.4f}")
    print(f"mAP@0.5:0.95: {val_metrics.results_dict.get('metrics/mAP50-95(B)', 0):.4f}")
    print(f"Inference Speed (ms per image): {val_metrics.speed.get('inference', 0):.2f} ms")

    return best_checkpoint

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--batch", type=int, default=2)
    args = parser.parse_args()

    train_model(epochs=args.epochs, imgsz=args.imgsz, batch_size=args.batch)
