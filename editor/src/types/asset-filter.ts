export interface SeriesFilterOption {
  value: string
  label: string
  id: string | null
  name: string | null
  isUnassigned?: boolean
}

export interface SizeCategoryFilterOption {
  value: string
  label: string
  isUnassigned?: boolean
}

export interface TagFilterOption {
  value: string
  label: string
  id?: string
  name: string
}
