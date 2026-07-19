#Requires -Version 5.1
# Raccoon Studio launcher - thin WPF shell over installer/engine.ps1.
# It only spawns engine verbs, parses their PROGRESS|/WARN|/DONE|/FAIL| lines,
# and updates controls. All install logic lives in the engine, not here.
# Styled to match the app's "Forge" theme (deep gunmetal + orange/cyan accents).
# NOTE: this file is UTF-8 *with BOM* on purpose - it contains emoji/symbols and
# WinPS 5.1 mis-decodes a BOM-less UTF-8 file as CP1252 (mojibake + parse breaks).
Add-Type -AssemblyName PresentationFramework
$Root   = Resolve-Path (Join-Path $PSScriptRoot '..')
$Engine = Join-Path $PSScriptRoot 'engine.ps1'
if (-not $env:HEALTH_URL) { $env:HEALTH_URL = 'http://localhost:3000' }

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
  xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
  Title="Raccoon Studio" Width="540" SizeToContent="Height"
  WindowStartupLocation="CenterScreen"
  WindowStyle="None" AllowsTransparency="True" Background="Transparent"
  ResizeMode="NoResize" FontFamily="Segoe UI">

  <Window.Resources>
    <!-- Large action card button -->
    <Style x:Key="Card" TargetType="Button">
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="SnapsToDevicePixels" Value="True"/>
      <Setter Property="HorizontalContentAlignment" Value="Left"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Grid x:Name="root">
              <Border x:Name="bd" CornerRadius="14" Background="{TemplateBinding Background}"
                      BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}"/>
              <Border x:Name="hl" CornerRadius="14" Background="#FFFFFF" Opacity="0"/>
              <ContentPresenter Margin="16,0" VerticalAlignment="Center" HorizontalAlignment="Left"/>
            </Grid>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="hl" Property="Opacity" Value="0.09"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="hl" Property="Opacity" Value="0.16"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="root" Property="Opacity" Value="0.32"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <!-- Window-chrome button (minimize / close) -->
    <Style x:Key="Chrome" TargetType="Button">
      <Setter Property="Foreground" Value="#9aa6b4"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FontSize" Value="13"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" CornerRadius="8" Background="Transparent">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Background" Value="#262b35"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="ChromeClose" TargetType="Button" BasedOn="{StaticResource Chrome}">
      <Style.Triggers>
        <Trigger Property="IsMouseOver" Value="True">
          <Setter Property="Foreground" Value="#ff6b85"/>
        </Trigger>
      </Style.Triggers>
    </Style>

    <!-- Slim rounded progress bar with an orange gradient fill -->
    <Style x:Key="Bar" TargetType="ProgressBar">
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ProgressBar">
            <Grid>
              <Border CornerRadius="6" Background="#15171d" BorderBrush="#242a33" BorderThickness="1"/>
              <Border x:Name="PART_Track" Margin="1"/>
              <Border x:Name="PART_Indicator" Margin="1" HorizontalAlignment="Left" CornerRadius="6">
                <Border.Background>
                  <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                    <GradientStop Color="#f5811e" Offset="0"/>
                    <GradientStop Color="#ffba70" Offset="1"/>
                  </LinearGradientBrush>
                </Border.Background>
              </Border>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <!-- Outer card: rounded, gradient surface, soft shadow on the transparent margin -->
  <Border Margin="18" CornerRadius="18" BorderThickness="1" BorderBrush="#242a33" VerticalAlignment="Top">
    <Border.Effect>
      <DropShadowEffect BlurRadius="30" ShadowDepth="0" Opacity="0.55" Color="#000000"/>
    </Border.Effect>
    <Border.Background>
      <LinearGradientBrush StartPoint="0.1,0" EndPoint="0.9,1">
        <GradientStop Color="#161922" Offset="0"/>
        <GradientStop Color="#0f1116" Offset="1"/>
      </LinearGradientBrush>
    </Border.Background>

    <Grid Margin="26,20,26,24">
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <!-- Header / drag region -->
      <Grid x:Name="TitleBar" Grid.Row="0" Background="Transparent">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <Border Grid.Column="0" Width="46" Height="46" CornerRadius="13" VerticalAlignment="Center">
          <Border.Background>
            <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
              <GradientStop Color="#f5811e" Offset="0"/>
              <GradientStop Color="#ff9a3d" Offset="1"/>
            </LinearGradientBrush>
          </Border.Background>
          <Border.Effect><DropShadowEffect BlurRadius="18" ShadowDepth="0" Opacity="0.7" Color="#f5811e"/></Border.Effect>
          <TextBlock Text="&#x1F99D;" FontSize="24" HorizontalAlignment="Center" VerticalAlignment="Center"/>
        </Border>
        <StackPanel Grid.Column="1" VerticalAlignment="Center" Margin="14,0,0,0">
          <TextBlock Text="RACCOON STUDIO" Foreground="#f6f8f9" FontSize="19" FontWeight="Bold" FontStyle="Italic"/>
          <TextBlock Text="Local AI image &amp; video studio" Foreground="#8c98a6" FontSize="12" Margin="0,1,0,0"/>
        </StackPanel>
        <StackPanel Grid.Column="2" Orientation="Horizontal" VerticalAlignment="Top">
          <Button x:Name="BtnMin" Style="{StaticResource Chrome}" Width="32" Height="30" Content="&#x2013;"/>
          <Button x:Name="BtnClose" Style="{StaticResource ChromeClose}" Width="32" Height="30" Content="&#x2715;" Margin="4,0,0,0"/>
        </StackPanel>
      </Grid>

      <!-- Status pill -->
      <Border Grid.Row="1" Margin="0,20,0,0" CornerRadius="999" Background="#191b21" BorderBrush="#242a33"
              BorderThickness="1" Padding="14,8" HorizontalAlignment="Left">
        <StackPanel Orientation="Horizontal">
          <Ellipse x:Name="StatusDot" Width="10" Height="10" Fill="#9aa6b4" VerticalAlignment="Center" Margin="0,0,9,0"/>
          <TextBlock x:Name="Status" Text="Checking..." Foreground="#dce5e6" FontSize="13" VerticalAlignment="Center"/>
        </StackPanel>
      </Border>

      <!-- Prompt -->
      <TextBlock Grid.Row="2" Margin="2,22,0,10" Text="WHAT WOULD YOU LIKE TO DO?"
                 Foreground="#7e8a98" FontSize="11" FontWeight="SemiBold"/>

      <!-- Action cards -->
      <UniformGrid Grid.Row="3" Columns="2" Rows="2">
        <Button x:Name="BtnStart" Style="{StaticResource Card}" Height="80" Margin="0,0,6,6" BorderBrush="#ffb368">
          <Button.Background>
            <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
              <GradientStop Color="#f5811e" Offset="0"/>
              <GradientStop Color="#ff9d3f" Offset="1"/>
            </LinearGradientBrush>
          </Button.Background>
          <StackPanel Orientation="Horizontal">
            <TextBlock Text="&#x25B6;" FontSize="22" Foreground="#1a0e02" VerticalAlignment="Center" Margin="0,0,13,0"/>
            <StackPanel VerticalAlignment="Center">
              <TextBlock Text="Start" FontSize="16" FontWeight="Bold" Foreground="#1a0e02"/>
              <TextBlock Text="Launch the studio" FontSize="11" Foreground="#6e3c0d"/>
            </StackPanel>
          </StackPanel>
        </Button>

        <Button x:Name="BtnInstall" Style="{StaticResource Card}" Height="80" Margin="6,0,0,6" Background="#10242a" BorderBrush="#1f4d57">
          <StackPanel Orientation="Horizontal">
            <TextBlock Text="&#x2B07;" FontSize="22" Foreground="#3fc9dd" VerticalAlignment="Center" Margin="0,0,13,0"/>
            <StackPanel VerticalAlignment="Center">
              <TextBlock Text="Install" FontSize="16" FontWeight="SemiBold" Foreground="#eaf0f2"/>
              <TextBlock Text="Set up everything" FontSize="11" Foreground="#9aa6b4"/>
            </StackPanel>
          </StackPanel>
        </Button>

        <Button x:Name="BtnUpdate" Style="{StaticResource Card}" Height="80" Margin="0,6,6,0" Background="#191b21" BorderBrush="#2b333f">
          <StackPanel Orientation="Horizontal">
            <TextBlock Text="&#x27F3;" FontSize="23" Foreground="#aab6c4" VerticalAlignment="Center" Margin="0,0,13,0"/>
            <StackPanel VerticalAlignment="Center">
              <TextBlock Text="Update" FontSize="16" FontWeight="SemiBold" Foreground="#eaf0f2"/>
              <TextBlock Text="Get the latest" FontSize="11" Foreground="#9aa6b4"/>
            </StackPanel>
          </StackPanel>
        </Button>

        <Button x:Name="BtnStop" Style="{StaticResource Card}" Height="80" Margin="6,6,0,0" Background="#241419" BorderBrush="#5a2230">
          <StackPanel Orientation="Horizontal">
            <TextBlock Text="&#x25A0;" FontSize="20" Foreground="#ff6b85" VerticalAlignment="Center" Margin="0,0,13,0"/>
            <StackPanel VerticalAlignment="Center">
              <TextBlock Text="Stop" FontSize="16" FontWeight="SemiBold" Foreground="#eaf0f2"/>
              <TextBlock Text="Shut it down" FontSize="11" Foreground="#9aa6b4"/>
            </StackPanel>
          </StackPanel>
        </Button>
      </UniformGrid>

      <!-- Progress -->
      <StackPanel Grid.Row="4" Margin="0,22,0,0">
        <Grid>
          <Grid.ColumnDefinitions>
            <ColumnDefinition Width="*"/>
            <ColumnDefinition Width="Auto"/>
          </Grid.ColumnDefinitions>
          <TextBlock x:Name="Step" Grid.Column="0" Text="Idle" Foreground="#aab6c4" FontSize="12"
                     TextTrimming="CharacterEllipsis" Margin="0,0,10,0" VerticalAlignment="Center"/>
          <TextBlock Grid.Column="1" Text="{Binding Value, ElementName=Bar, StringFormat={}{0:0}%}"
                     Foreground="#ffa64d" FontSize="12" FontWeight="SemiBold" VerticalAlignment="Center"/>
        </Grid>
        <ProgressBar x:Name="Bar" Style="{StaticResource Bar}" Height="10" Margin="0,7,0,0" Minimum="0" Maximum="100"/>
      </StackPanel>

      <!-- Activity log -->
      <Expander Grid.Row="5" Margin="0,16,0,0" Foreground="#8c98a6" FontSize="12">
        <Expander.Header><TextBlock Text="Activity log" Foreground="#8c98a6" FontSize="12"/></Expander.Header>
        <Border CornerRadius="10" Background="#0c0e13" BorderBrush="#1d222b" BorderThickness="1" Margin="0,8,0,0">
          <TextBox x:Name="Log" Height="96" IsReadOnly="True" VerticalScrollBarVisibility="Auto"
                   Background="Transparent" Foreground="#9fb0a6" BorderThickness="0" Padding="10,8"
                   FontFamily="Consolas" FontSize="11" TextWrapping="NoWrap"/>
        </Border>
      </Expander>
    </Grid>
  </Border>
</Window>
'@
$win = [Windows.Markup.XamlReader]::Load((New-Object Xml.XmlNodeReader $xaml))
$ctl = @{}
'Status','StatusDot','BtnInstall','BtnStart','BtnUpdate','BtnStop','Bar','Step','Log','TitleBar','BtnMin','BtnClose' |
  ForEach-Object { $ctl[$_] = $win.FindName($_) }

function Set-Status([string]$label, [string]$hex) {
  $ctl.Status.Text = $label
  $ctl.StatusDot.Fill = (New-Object Windows.Media.BrushConverter).ConvertFromString($hex)
}

function Refresh-State {
  $s = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Engine status).Trim()
  switch ($s) {
    'running'       { Set-Status 'Running - studio is live' '#3fd07a' }
    'stopped'       { Set-Status 'Installed - ready to start' '#f5811e' }
    'not-installed' { Set-Status 'Not installed yet' '#9aa6b4' }
    default         { Set-Status $s '#9aa6b4' }
  }
  $ctl.BtnInstall.IsEnabled = $true
  $ctl.BtnStart.IsEnabled  = ($s -eq 'stopped')
  $ctl.BtnUpdate.IsEnabled = ($s -ne 'not-installed')
  $ctl.BtnStop.IsEnabled   = ($s -eq 'running')
}

function Run-Verb([string]$verb) {
  # Block re-entrancy while a verb runs; Refresh-State re-gates buttons at the end.
  $ctl.BtnInstall.IsEnabled = $false; $ctl.BtnStart.IsEnabled = $false
  $ctl.BtnUpdate.IsEnabled  = $false; $ctl.BtnStop.IsEnabled  = $false
  $ctl.Log.Clear(); $ctl.Bar.Value = 0
  $ctl.Step.Foreground = (New-Object Windows.Media.BrushConverter).ConvertFromString('#aab6c4')
  $ctl.Step.Text = 'Working...'
  Set-Status 'Working...' '#ffa64d'
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName='powershell.exe'; $psi.Arguments="-NoProfile -ExecutionPolicy Bypass -File `"$Engine`" $verb"
  $psi.RedirectStandardOutput=$true; $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
  $p=[Diagnostics.Process]::Start($psi)
  while (-not $p.HasExited -or -not $p.StandardOutput.EndOfStream) {
    $line = $p.StandardOutput.ReadLine(); if ($null -eq $line) { continue }
    $parts = $line -split '\|'
    switch ($parts[0]) {
      'PROGRESS' { $ctl.Bar.Value=[int]$parts[3]; $ctl.Step.Text=$parts[4] }
      'WARN'     { $ctl.Log.AppendText("! $($parts[1])`n") }
      'FAIL'     { $ctl.Step.Text="Error during $($parts[1]): $($parts[2])"; $ctl.Step.Foreground = (New-Object Windows.Media.BrushConverter).ConvertFromString('#ff6b85') }
      'DONE'     { $ctl.Bar.Value=100; $ctl.Step.Text='Done.' }
    }
    $ctl.Log.AppendText("$line`n"); $win.Dispatcher.Invoke([Action]{}, 'Background')
  }
  if ($verb -eq 'start') { Start-Process $env:HEALTH_URL }
  Refresh-State
}

# Window chrome (borderless window needs manual drag / minimize / close)
$ctl.TitleBar.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch {} })
$ctl.BtnMin.Add_Click({ $win.WindowState = 'Minimized' })
$ctl.BtnClose.Add_Click({ $win.Close() })
$win.Add_KeyDown({ if ($_.Key -eq 'Escape') { $win.Close() } })

$ctl.BtnInstall.Add_Click({ Run-Verb 'install' })
$ctl.BtnStart.Add_Click({ Run-Verb 'start' })
$ctl.BtnUpdate.Add_Click({ Run-Verb 'update' })
$ctl.BtnStop.Add_Click({ Run-Verb 'stop' })
Refresh-State
$win.ShowDialog() | Out-Null
