#!/usr/bin/env python3
# ============================================================================
# Ragnarok — Ensamblador de UI por Componentes
# Ensambla ui/panel_control.html a partir de ui/componentes/ en 1 ms
# ============================================================================
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

UI_DIR = os.path.dirname(os.path.abspath(__file__))
COMP_DIR = os.path.join(UI_DIR, 'componentes')

def read_comp(rel_path):
    path = os.path.join(COMP_DIR, rel_path)
    with open(path, 'r', encoding='utf-8') as f:
        return f.read().rstrip()

template = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ragnarok — Panel de Control & Pipeline</title>
  <link rel="stylesheet" href="estilos_panel.css?v=20261004" />
</head>
<body>

<div class="layout">

  <!-- ══════════════ COMPONENTE: LAYOUT / SIDEBAR ══════════════ -->
{read_comp('layout/sidebar.html')}

  <!-- ══════════════ COMPONENTE: LAYOUT / TOPBAR ══════════════ -->
{read_comp('layout/topbar.html')}

  <!-- ══════════════ MAIN CONTENT (VISTAS) ══════════════ -->
  <main class="main" id="main-content">
{read_comp('vistas/vista_dashboard.html')}
{read_comp('vistas/vista_videos.html')}
{read_comp('vistas/vista_estudio.html')}
  </main>

</div>

<!-- ══════════════ COMPONENTE: WIDGET REPRODUCTOR PiP ══════════════ -->
{read_comp('widgets/reproductor_pip.html')}

<!-- ══════════════ COMPONENTES: SUITE DE MODALES ══════════════ -->
{read_comp('modales/modal_programar.html')}
{read_comp('modales/modal_configuracion.html')}
{read_comp('modales/modal_velocidad.html')}
{read_comp('modales/modal_publicar_activo.html')}
{read_comp('modales/modal_telegram_lotes.html')}
{read_comp('modales/modal_telegram_manual.html')}
{read_comp('modales/modal_facebook.html')}
{read_comp('modales/modal_confirmacion.html')}

<div class="tc" id="tc"></div>

<!-- ══════════════ JAVASCRIPT MODULAR (ARQUITECTURA ULTRA LIGERA <3 MB) ══════════════ -->
<script src="js/01_core_estado.js"></script>
<script src="js/02_eventos_sse.js"></script>
<script src="js/03_pipeline_fases.js"></script>
<script src="js/04_gestion_fuentes.js"></script>
<script src="js/05_cola_pendientes.js"></script>
<script src="js/06_galeria_videos.js"></script>
<script src="js/07_reproductor_pip.js"></script>
<script src="js/08_estudio_editor.js"></script>
<script src="js/09_publicacion_tg.js"></script>
<script src="js/10_auth_facebook.js"></script>
<script src="js/11_configuracion.js"></script>
</body>
</html>
"""

output_path = os.path.join(UI_DIR, 'panel_control.html')
with open(output_path, 'w', encoding='utf-8') as out:
    out.write(template)

print(f"panel_control.html ensamblado con éxito desde 14 componentes ({len(template.splitlines())} líneas).")
