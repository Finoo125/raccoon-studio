export interface EnhanceSettingsValues {
  userIntent: string
  model: string
  environment: string
  scenario: string
  camera: string
  music: string
  dialogueTier: 'none' | 'standard' | 'talkative'
  energy: number
  pov: boolean
  povGender: 'female' | 'male'
}
