export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function errorHandler(error, _request, response, _next) {
  if (error.code === '23505') {
    response.status(409).json({ error: 'Ya existe un registro con esos datos.' })
    return
  }

  if (error.code === '23503') {
    response.status(409).json({ error: 'El registro está relacionado con otros datos.' })
    return
  }

  if (error.code === '23514' || error.code === '22003' || error.code === '22P02') {
    response.status(400).json({ error: 'Los datos no cumplen las reglas del inventario.' })
    return
  }

  const status = Number.isInteger(error.status) ? error.status : 500
  if (status >= 500) {
    console.error('Error interno de la API:', error)
  }

  response.status(status).json({
    error: status === 500 ? 'Ocurrió un error interno.' : error.message,
  })
}
