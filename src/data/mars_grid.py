import json
import math
import os
from collections import defaultdict

# ===================== CONFIGURACIÓN =====================
RUTA_DATOS = r""
CARPETA_SALIDA = r"C:\Users\npsua\OneDrive\Escritorio\Héctor\Estudio\PROYECTOS\Hackathon\output"

RADIO_MARTE_M = 3396190.0          # radio de Marte en metros (igual que tu dataset)
VELOCIDAD_KMH = 1.0                # velocidad Y en km/h (ajustable)
COLS = 25                          # columnas de la rejilla
ROWS = 25                          # filas de la rejilla (total 625 celdas)
# =========================================================


def haversine_m(lat1, lon1, lat2, lon2, R=RADIO_MARTE_M):
    """Distancia en metros entre dos puntos (lat, lon) sobre una esfera de radio R."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def riesgo_celda(puntos):
    """
    Nivel de riesgo simple (0-5) basado en rango de elevación de la celda.
    0 = sin datos (no transitable / desconocido)
    1 = plano
    2 = pendiente baja
    3 = pendiente media
    4 = pendiente alta
    5 = crítica
    """
    if not puntos:
        return 0

    elevs = [p["elev_m"] for p in puntos]
    e_min = min(elevs)
    e_max = max(elevs)
    rango = e_max - e_min

    if rango < 1.0:
        return 1
    elif rango < 5.0:
        return 2
    elif rango < 15.0:
        return 3
    elif rango < 30.0:
        return 4
    else:
        return 5


def main():
    # --- Cargar datos ---
    with open(RUTA_DATOS, encoding="utf-8") as f:
        datos = json.load(f)

    points = datos["points"]

    # --- Bounding box ---
    lons = [p["lon"] for p in points]
    lats = [p["lat"] for p in points]
    elevs = [p["elev_m"] for p in points]

    lon_min, lon_max = min(lons), max(lons)
    lat_min, lat_max = min(lats), max(lats)
    elev_global_min, elev_global_max = min(elevs), max(elevs)

    # Evitar división por cero si todo está en la misma coordenada
    if lon_max == lon_min:
        lon_max = lon_min + 1e-9
    if lat_max == lat_min:
        lat_max = lat_min + 1e-9

    cell_w_deg = (lon_max - lon_min) / COLS
    cell_h_deg = (lat_max - lat_min) / ROWS

    # --- Asignar puntos a celdas ---
    celdas = defaultdict(list)
    for p in points:
        col = int((p["lon"] - lon_min) / cell_w_deg)
        row = int((p["lat"] - lat_min) / cell_h_deg)
        # Seguridad: si cae justo en el borde máximo, meter en la última celda
        col = min(col, COLS - 1)
        row = min(row, ROWS - 1)
        celdas[(row, col)].append(p)

    # --- Construir grids ---
    velocidad_ms = VELOCIDAD_KMH * 1000.0 / 3600.0

    grid_riesgo = []
    grid_tiempo = []

    for row in range(ROWS):
        for col in range(COLS):
            cell_id = row * COLS + col

            c_lat_min = lat_min + row * cell_h_deg
            c_lat_max = lat_min + (row + 1) * cell_h_deg
            c_lon_min = lon_min + col * cell_w_deg
            c_lon_max = lon_min + (col + 1) * cell_w_deg

            pts = celdas.get((row, col), [])
            n_pts = len(pts)

            # Riesgo
            risk = riesgo_celda(pts)

            # Tiempo: distancia real de la celda en metros (diagonal aproximada)
            # Usamos el lado mayor para ser conservadores
            d_lat = haversine_m(c_lat_min, c_lon_min, c_lat_max, c_lon_min)
            d_lon = haversine_m(c_lat_min, c_lon_min, c_lat_min, c_lon_max)
            distancia_m = max(d_lat, d_lon)

            if velocidad_ms > 0 and distancia_m > 0:
                tiempo_s = distancia_m / velocidad_ms
            else:
                tiempo_s = 0.0

            # Estadísticas de elevación (opcional, útil para depurar)
            if pts:
                elev_media = sum(p["elev_m"] for p in pts) / n_pts
                elev_max = max(p["elev_m"] for p in pts)
                elev_min = min(p["elev_m"] for p in pts)
            else:
                elev_media = elev_max = elev_min = None

            grid_riesgo.append({
                "cell": cell_id,
                "row": row,
                "col": col,
                "lon_min": round(c_lon_min, 6),
                "lat_min": round(c_lat_min, 6),
                "lon_max": round(c_lon_max, 6),
                "lat_max": round(c_lat_max, 6),
                "risk": risk,
                "points": n_pts,
                "elev_mean": round(elev_media, 2) if elev_media is not None else None,
                "elev_min": round(elev_min, 2) if elev_min is not None else None,
                "elev_max": round(elev_max, 2) if elev_max is not None else None,
            })

            grid_tiempo.append({
                "cell": cell_id,
                "row": row,
                "col": col,
                "lon_min": round(c_lon_min, 6),
                "lat_min": round(c_lat_min, 6),
                "lon_max": round(c_lon_max, 6),
                "lat_max": round(c_lat_max, 6),
                "time_s": round(tiempo_s, 3),
                "distance_m": round(distancia_m, 2),
                "speed_kmh": VELOCIDAD_KMH,
            })

    # --- Escribir JSON ---
    os.makedirs(CARPETA_SALIDA, exist_ok=True)

    riesgo_path = os.path.join(CARPETA_SALIDA, "risk_grid.json")
    tiempo_path = os.path.join(CARPETA_SALIDA, "time_grid.json")

    with open(riesgo_path, "w", encoding="utf-8") as f:
        json.dump({
            "meta": {
                "source": os.path.basename(RUTA_DATOS),
                "radius_mars_m": RADIO_MARTE_M,
                "rows": ROWS,
                "cols": COLS,
                "total_cells": ROWS * COLS,
                "lon_min": round(lon_min, 6),
                "lon_max": round(lon_max, 6),
                "lat_min": round(lat_min, 6),
                "lat_max": round(lat_max, 6),
                "elev_global_min_m": round(elev_global_min, 2),
                "elev_global_max_m": round(elev_global_max, 2),
                "risk_scale": "0=sin datos, 1=plano, 2=bajo, 3=medio, 4=alto, 5=critico",
            },
            "grid": grid_riesgo,
        }, f, ensure_ascii=False, indent=2)

    with open(tiempo_path, "w", encoding="utf-8") as f:
        json.dump({
            "meta": {
                "source": os.path.basename(RUTA_DATOS),
                "radius_mars_m": RADIO_MARTE_M,
                "rows": ROWS,
                "cols": COLS,
                "total_cells": ROWS * COLS,
                "speed_kmh": VELOCIDAD_KMH,
                "speed_ms": round(velocidad_ms, 4),
                "lon_min": round(lon_min, 6),
                "lon_max": round(lon_max, 6),
                "lat_min": round(lat_min, 6),
                "lat_max": round(lat_max, 6),
            },
            "grid": grid_tiempo,
        }, f, ensure_ascii=False, indent=2)

    print(f"[OK] Generado: {riesgo_path}")
    print(f"[OK] Generado: {tiempo_path}")
    print(f"  Celdas: {ROWS}x{COLS} = {ROWS*COLS}")
    print(f"  Velocidad: {VELOCIDAD_KMH} km/h ({velocidad_ms:.4f} m/s)")
    print(f"  Área: lon [{lon_min:.4f}, {lon_max:.4f}], lat [{lat_min:.4f}, {lat_max:.4f}]")


if __name__ == "__main__":
    main()
