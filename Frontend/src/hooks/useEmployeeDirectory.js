import { useEffect, useState } from 'react'
import {
  listEmployees,
  employeeSummary,
  listDepartmentOptions,
} from '../services/employees.js'
import { employeeFromApi } from '../utils/employees.js'

export default function useEmployeeDirectory(
  token,
  { search, departmentId, role, status, page, pageSize },
  setPage,
) {
  const [revision, setRevision] = useState(0)
  const [directory, setDirectory] = useState({
    key: null,
    rows: [],
    total: 0,
    error: '',
  })
  const [metadata, setMetadata] = useState({
    key: null,
    summary: null,
    departments: [],
    error: '',
  })
  const key = JSON.stringify([
      token,
      search,
      departmentId,
      role,
      status,
      page,
      pageSize,
      revision,
    ]),
    metaKey = JSON.stringify([token, revision])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => {
      listEmployees(
        token,
        { search, departmentId, role, status, page, pageSize },
        controller.signal,
      )
        .then((result) => {
          if (
            !Array.isArray(result.items) ||
            !Number.isSafeInteger(result.total)
          )
            throw new Error('Employee service returned an invalid directory.')
          if (active) {
            const maximum = Math.max(1, Math.ceil(result.total / pageSize))
            if (page > maximum) setPage(maximum)
            setDirectory({
              key,
              rows: result.items.map(employeeFromApi),
              total: result.total,
              error: '',
            })
          }
        })
        .catch((error) => {
          if (active && error.name !== 'AbortError')
            setDirectory({ key, rows: [], total: 0, error: error.message })
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [
    token,
    search,
    departmentId,
    role,
    status,
    page,
    pageSize,
    revision,
    key,
    setPage,
  ])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    Promise.all([
      employeeSummary(token, controller.signal),
      listDepartmentOptions(token, controller.signal),
    ])
      .then(([summary, departments]) => {
        if (active)
          setMetadata({ key: metaKey, summary, departments, error: '' })
      })
      .catch((error) => {
        if (active && error.name !== 'AbortError')
          setMetadata({
            key: metaKey,
            summary: null,
            departments: [],
            error: error.message,
          })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [token, revision, metaKey])
  const current = directory.key === key,
    metaCurrent = metadata.key === metaKey
  return {
    rows: current ? directory.rows : [],
    total: current ? directory.total : 0,
    loading: !current,
    error: current ? directory.error : '',
    summary: metaCurrent ? metadata.summary : null,
    departments: metaCurrent ? metadata.departments : [],
    metadataError: metaCurrent ? metadata.error : '',
    reload: () => setRevision((value) => value + 1),
  }
}
