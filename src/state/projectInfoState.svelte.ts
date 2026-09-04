import type { ProjectInfo } from '../types'
import { register } from './sessionRegistry'

let info = $state<ProjectInfo>({
  projectName: '',
  organization: '',
  analyst: '',
  countyLocality: '',
  notes: '',
})

export const projectInfoState = {
  get value(): ProjectInfo {
    return info
  },
  update(fields: Partial<ProjectInfo>) {
    info = { ...info, ...fields }
  },
  // SessionStore opt-in (docs/06).
  getSnapshot(): ProjectInfo {
    return $state.snapshot(info)
  },
  applySnapshot(snap: ProjectInfo): void {
    info = snap
  },
}

register(
  'projectInfo',
  () => projectInfoState.getSnapshot(),
  (v) => projectInfoState.applySnapshot(v as ProjectInfo),
)
