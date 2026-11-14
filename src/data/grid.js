const COST_FIELDS = ['risk', 'timeSeconds'];

/** Validates either the legacy matrix contract or the flat cell-list contract. */
export function validateGrid(grid) {
  if (Array.isArray(grid)) return validateCellList(grid);

  const errors = [];
  if (!grid || typeof grid !== 'object') return ['Grid must be an object'];
  if (grid.crs !== 'IAU_2000:104905') errors.push('crs must be IAU_2000:104905 (Mars 2000 equirectangular, meters)');
  if (!Number.isInteger(grid.rows) || grid.rows < 1) errors.push('rows must be a positive integer');
  if (!Number.isInteger(grid.cols) || grid.cols < 1) errors.push('cols must be a positive integer');
  if (!grid.transform || !['originX', 'originY', 'pixelWidth', 'pixelHeight'].every((key) => Number.isFinite(grid.transform[key]))) {
    errors.push('transform must define finite originX, originY, pixelWidth, and pixelHeight');
  } else if (grid.transform.pixelWidth === 0 || grid.transform.pixelHeight === 0) {
    errors.push('pixelWidth and pixelHeight must be non-zero');
  }

  for (const field of [...COST_FIELDS, 'blocked']) {
    if (!Array.isArray(grid[field]) || grid[field].length !== grid.rows) {
      errors.push(`${field} must have exactly rows entries`);
      continue;
    }
    for (const [rowIndex, row] of grid[field].entries()) {
      if (!Array.isArray(row) || row.length !== grid.cols) {
        errors.push(`${field}[${rowIndex}] must have exactly cols entries`);
        continue;
      }
      for (const [colIndex, value] of row.entries()) {
        if (field === 'blocked') {
          if (typeof value !== 'boolean') errors.push(`blocked[${rowIndex}][${colIndex}] must be boolean`);
        } else if (grid.blocked?.[rowIndex]?.[colIndex] === true) {
          if (value !== null) errors.push(`${field}[${rowIndex}][${colIndex}] must be null in a blocked cell`);
        } else if (!Number.isFinite(value) || value <= 0) {
          errors.push(`${field}[${rowIndex}][${colIndex}] must be a positive finite number`);
        } else if (field === 'risk' && (value < 1 || value > 10)) {
          errors.push(`risk[${rowIndex}][${colIndex}] must be between 1 and 10`);
        }
      }
    }
  }
  return errors;
}

export async function loadGrid(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load grid (${response.status})`);
  const grid = await response.json();
  const errors = validateGrid(grid);
  if (errors.length) throw new Error(`Invalid grid:\n- ${errors.join('\n- ')}`);
  return grid;
}

function validateCellList(cells) {
  const errors = [];
  if (cells.length === 0) return ['Grid must contain at least one cell'];

  const positions = new Set();
  const ids = new Set();
  const bounds = ['lon_min', 'lat_min', 'lon_max', 'lat_max'];
  const elevations = ['elev_mean', 'elev_min', 'elev_max'];

  for (const [index, cell] of cells.entries()) {
    const label = `cells[${index}]`;
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!Number.isInteger(cell.cell) || cell.cell < 0) errors.push(`${label}.cell must be a non-negative integer`);
    else if (ids.has(cell.cell)) errors.push(`${label}.cell duplicates id ${cell.cell}`);
    else ids.add(cell.cell);

    if (!Number.isInteger(cell.row) || cell.row < 0 || !Number.isInteger(cell.col) || cell.col < 0) {
      errors.push(`${label} must have non-negative integer row and col values`);
    } else {
      const position = `${cell.row},${cell.col}`;
      if (positions.has(position)) errors.push(`${label} duplicates grid position (${position})`);
      else positions.add(position);
    }

    if (typeof cell.traversable !== 'boolean') errors.push(`${label}.traversable must be boolean`);
    if (cell.risk !== null && (!Number.isFinite(cell.risk) || cell.risk < 0)) {
      errors.push(`${label}.risk must be a non-negative number or null`);
    }
    if (!('points' in cell) || (cell.points !== null && (!Number.isFinite(cell.points) || cell.points < 0))) {
      errors.push(`${label}.points must be a non-negative number or null`);
    }
    for (const field of bounds) {
      if (!Number.isFinite(cell[field])) errors.push(`${label}.${field} must be a finite number`);
    }
    if (bounds.every((field) => Number.isFinite(cell[field]))) {
      if (cell.lon_min >= cell.lon_max) errors.push(`${label}.lon_min must be less than lon_max`);
      if (cell.lat_min >= cell.lat_max) errors.push(`${label}.lat_min must be less than lat_max`);
    }
    for (const field of elevations) {
      if (!(field in cell) || (cell[field] !== null && !Number.isFinite(cell[field]))) {
        errors.push(`${label}.${field} must be a finite number or null`);
      }
    }
  }
  return errors;
}
